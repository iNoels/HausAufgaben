"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

interface UiUnteraufgabe {
  status: boolean;
  freigegeben: boolean;
  titel: string;
  hinweis?: string;
}

interface UiStammdatenMieter {
  ID: number;
  Name: string;
  Telefon: string;
}

interface UiStammdaten {
  typName?: string;
  bereichId: number;
  hausId: number;
  eingang: string;
  lage: string;
  adresse?: {
    "Straße": string;
    Hausnummer: string;
    PLZ: string;
    Ort: string;
  };
  mieter: UiStammdatenMieter[];
}

interface UiTask {
  id: string;
  uid?: string;
  status?: string;
  due?: string;
  summary: {
    felder: Record<string, string>;
  };
  unteraufgaben: UiUnteraufgabe[];
  dtStamp?: string;
  lastModified?: string;
  stammdaten?: UiStammdaten | null;
}

function parseDueDate(due?: string): Date | null {
  if (!due) {
    return null;
  }

  if (/^\d{8}$/.test(due)) {
    const year = Number(due.slice(0, 4));
    const month = Number(due.slice(4, 6));
    const day = Number(due.slice(6, 8));
    return new Date(year, month - 1, day);
  }

  const parsed = new Date(due);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseIcsUtcDateTime(value?: string): Date | null {
  if (!value) {
    return null;
  }

  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);

  if (match) {
    const [, y, m, d, hh, mm, ss] = match;
    return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss)));
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateDe(value?: string): string {
  const parsed = parseDueDate(value);
  return parsed
    ? parsed.toLocaleDateString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    : "-";
}

function formatLastModifiedDe(value?: string): string {
  const parsed = parseIcsUtcDateTime(value);

  if (!parsed) {
    return "-";
  }

  return parsed.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Europe/Berlin",
  });
}

function compareTasksByDueAsc(a: UiTask, b: UiTask): number {
  const dueA = parseDueDate(a.due);
  const dueB = parseDueDate(b.due);

  if (dueA && dueB) {
    return dueA.getTime() - dueB.getTime();
  }

  if (dueA) {
    return -1;
  }

  if (dueB) {
    return 1;
  }

  return (a.summary.felder.Titel || "").localeCompare(b.summary.felder.Titel || "", "de");
}

function isTaskCompleted(task: UiTask): boolean {
  if ((task.status ?? "").trim().toUpperCase() === "COMPLETED") {
    return true;
  }

  const freigegebeneUnteraufgaben = task.unteraufgaben.filter((item) => item.freigegeben);
  return freigegebeneUnteraufgaben.length > 0 && freigegebeneUnteraufgaben.every((item) => item.status);
}

export default function AbgeschlossenPage() {
  const [tasks, setTasks] = useState<UiTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const refresh = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/tasks", { cache: "no-store" });
      const data = (await response.json()) as { tasks?: UiTask[]; error?: string };

      if (!response.ok || !data.tasks) {
        throw new Error(data.error ?? "Aufgaben konnten nicht geladen werden.");
      }

      setTasks(data.tasks);
    } catch (fetchError) {
      const message = fetchError instanceof Error ? fetchError.message : "Unbekannter Fehler";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const updateUnteraufgabe = async (
    taskId: string,
    unteraufgabeIndex: number,
    nextStatus: boolean
  ) => {
    const key = `${taskId}:${unteraufgabeIndex}`;
    setSavingKey(key);
    setError(null);

    try {
      const response = await fetch(`/api/tasks/${taskId}/subtasks/${unteraufgabeIndex}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: nextStatus }),
      });

      const data = (await response.json()) as { task?: UiTask; error?: string };

      if (!response.ok || !data.task) {
        throw new Error(data.error ?? "Unteraufgabe konnte nicht gespeichert werden.");
      }

      setTasks((current) => current.map((task) => (task.id === taskId ? data.task! : task)));
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Unbekannter Fehler";
      setError(message);
    } finally {
      setSavingKey(null);
    }
  };

  const erledigteTasks = useMemo(() => {
    return tasks.filter((task) => isTaskCompleted(task)).sort(compareTasksByDueAsc);
  }, [tasks]);

  const erledigteUnteraufgabenCount = useMemo(() => {
    return erledigteTasks.reduce((sum, task) => sum + task.unteraufgaben.filter((item) => item.freigegeben && item.status).length, 0);
  }, [erledigteTasks]);

  const unteraufgabenCount = useMemo(() => {
    return erledigteTasks.reduce((sum, task) => sum + task.unteraufgaben.filter((item) => item.freigegeben).length, 0);
  }, [erledigteTasks]);

  return (
    <div className="min-h-screen bg-neutral-950 px-6 py-10 text-neutral-100">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-5xl flex-col gap-6">
        <header className="rounded-xl bg-neutral-900 p-5 shadow-sm ring-1 ring-neutral-800">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold">Abgeschlossene Aufgaben</h1>
              <p className="mt-2 text-sm text-neutral-300">Hier werden alle abgeschlossenen Aufgaben angezeigt.</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Taskliste aktualisieren"
                onClick={() => void refresh()}
                disabled={isLoading}
                className="rounded-full border border-neutral-700 p-2 text-neutral-300 hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M20 12a8 8 0 1 1-2.34-5.66" />
                  <path d="M20 4v6h-6" />
                </svg>
              </button>
              <Link
                href="/"
                className="rounded border border-neutral-700 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800"
              >
                Zuruck
              </Link>
            </div>
          </div>
        </header>

        <main className="flex-1 space-y-4">
          {error && <section className="rounded-xl bg-red-950/50 p-4 text-sm text-red-200 ring-1 ring-red-800">{error}</section>}

          {isLoading ? (
            <section className="rounded-xl bg-neutral-900 p-4 text-sm text-neutral-300 shadow-sm ring-1 ring-neutral-800">
              Lade Aufgaben...
            </section>
          ) : erledigteTasks.length === 0 ? (
            <section className="rounded-xl bg-neutral-900 p-4 text-sm text-neutral-300 shadow-sm ring-1 ring-neutral-800">
              Keine abgeschlossenen Aufgaben gefunden.
            </section>
          ) : (
            <div className="space-y-4">
              {erledigteTasks.map((task) => (
                <article key={task.id} className="rounded-xl bg-emerald-950/60 p-5 shadow-sm ring-1 ring-emerald-800">
                  <div className="mb-1 flex items-center justify-between gap-4 text-xs text-neutral-400">
                    <span>
                      {task.stammdaten
                        ? `Haus ${task.stammdaten.hausId} - ${task.stammdaten.typName ?? "Typ"} ${task.stammdaten.bereichId}`
                        : task.summary.felder.Bereich || "Unbekannter Bereich"}
                    </span>
                    <span>Geändert: {formatLastModifiedDe(task.lastModified)}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <input type="radio" aria-label="Aufgabenstatus" checked disabled readOnly />
                    <h2 className="text-lg font-semibold">{task.summary.felder.Titel || "Ohne Titel"}</h2>
                  </div>

                  <p className="text-sm text-neutral-400">Verantwortlich: {task.summary.felder.Verantwortlich || "-"}</p>
                  <p className="text-sm text-neutral-400">Fälligkeit: {formatDateDe(task.due)}</p>

                  <ul className="mt-4 space-y-2">
                    {task.unteraufgaben.map((item, index) => {
                      if (!item.freigegeben) {
                        return null;
                      }

                      const key = `${task.id}:${index}`;
                      const locked = savingKey === key;
                      const subtaskContainerClass = item.status
                        ? "bg-emerald-950/50 ring-emerald-800"
                        : "bg-neutral-800 ring-neutral-700";

                      return (
                        <li
                          key={key}
                          className={`rounded-lg p-3 ring-1 ${subtaskContainerClass} ${locked ? "cursor-default" : "cursor-pointer"}`}
                          onClick={(event) => {
                            if (locked) {
                              return;
                            }

                            const target = event.target as HTMLElement;
                            if (target.closest("input,button,textarea,select,a,label")) {
                              return;
                            }

                            void updateUnteraufgabe(task.id, index, !item.status);
                          }}
                        >
                          <div className="flex items-start gap-3">
                            <input
                              type="radio"
                              aria-label="Unteraufgabe abgeschlossen"
                              checked={item.status}
                              disabled={locked}
                              onClick={() => {
                                if (locked) {
                                  return;
                                }

                                void updateUnteraufgabe(task.id, index, !item.status);
                              }}
                              onChange={() => undefined}
                              className="mt-1"
                            />
                            <div className="flex items-center gap-2">
                              <p className="font-medium text-neutral-100">{item.titel}</p>
                              {item.hinweis && <span className="text-xs text-neutral-300">{item.hinweis}</span>}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </article>
              ))}
            </div>
          )}
        </main>

        <footer className="rounded-xl bg-neutral-900 p-4 text-sm text-neutral-300 shadow-sm ring-1 ring-neutral-800">
          <div className="flex items-center justify-between gap-4">
            <span className="font-medium">HausAufgaben</span>
            <div className="text-right">
              <p>Abgeschlossene Aufgaben: {erledigteTasks.length}</p>
              <p>Unteraufgaben: {erledigteUnteraufgabenCount}/{unteraufgabenCount}</p>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
