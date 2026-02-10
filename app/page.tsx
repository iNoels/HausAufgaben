"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type UiStatus = boolean;

interface UiUnteraufgabe {
  status: UiStatus;
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

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isTaskCompleted(task: UiTask): boolean {
  if ((task.status ?? "").trim().toUpperCase() === "COMPLETED") {
    return true;
  }

  const freigegebeneUnteraufgaben = task.unteraufgaben.filter((item) => item.freigegeben);
  return freigegebeneUnteraufgaben.length > 0 && freigegebeneUnteraufgaben.every((item) => item.status);
}

function getTaskCardClass(task: UiTask): string {
  if (isTaskCompleted(task)) {
    return "bg-emerald-950/60 ring-emerald-800";
  }

  const dueDate = parseDueDate(task.due);

  if (!dueDate) {
    return "bg-neutral-900 ring-neutral-800";
  }

  const today = startOfDay(new Date());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dueDay = startOfDay(dueDate);

  if (dueDay < today) {
    return "bg-red-950/50 ring-red-800";
  }

  if (dueDay.getTime() === today.getTime() || dueDay.getTime() === tomorrow.getTime()) {
    return "bg-amber-950/50 ring-amber-800";
  }

  return "bg-neutral-900 ring-neutral-800";
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

function TasksPage() {
  const [tasks, setTasks] = useState<UiTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [hinweisDrafts, setHinweisDrafts] = useState<Record<string, string>>({});
  const [activeHinweisKey, setActiveHinweisKey] = useState<string | null>(null);
  const [verantwortlichFilter, setVerantwortlichFilter] = useState("Alle");

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
      const nextDrafts: Record<string, string> = {};
      data.tasks.forEach((task) => {
        task.unteraufgaben.forEach((item, index) => {
          nextDrafts[`${task.id}:${index}`] = item.hinweis ?? "";
        });
      });
      setHinweisDrafts(nextDrafts);
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

  const offeneCount = useMemo(() => {
    return tasks.reduce((sum, task) => {
      const offene = task.unteraufgaben.filter((item) => item.freigegeben && !item.status).length;
      return sum + offene;
    }, 0);
  }, [tasks]);

  const offeneAufgabenCount = useMemo(() => {
    return tasks.filter((task) => !isTaskCompleted(task)).length;
  }, [tasks]);

  const unteraufgabenCount = useMemo(() => {
    return tasks.reduce((sum, task) => sum + task.unteraufgaben.filter((item) => item.freigegeben).length, 0);
  }, [tasks]);

  const verantwortlichOptionen = useMemo(() => {
    const values = Array.from(
      new Set(
        tasks
          .map((task) => task.summary.felder.Verantwortlich?.trim() || "")
          .filter((value) => value.length > 0)
      )
    ).sort((a, b) => a.localeCompare(b, "de"));

    return ["Alle", ...values];
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    const offeneTasks = tasks.filter((task) => !isTaskCompleted(task));
    const list =
      verantwortlichFilter === "Alle"
        ? offeneTasks
        : offeneTasks.filter((task) => (task.summary.felder.Verantwortlich?.trim() || "") === verantwortlichFilter);

    return [...list].sort(compareTasksByDueAsc);
  }, [tasks, verantwortlichFilter]);

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
      setHinweisDrafts((current) => {
        const next = { ...current };
        data.task!.unteraufgaben.forEach((item, index) => {
          next[`${taskId}:${index}`] = item.hinweis ?? "";
        });
        return next;
      });
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Unbekannter Fehler";
      setError(message);
    } finally {
      setSavingKey(null);
    }
  };

  const updateHinweis = async (taskId: string, unteraufgabeIndex: number) => {
    const key = `${taskId}:${unteraufgabeIndex}`;
    const hinweis = (hinweisDrafts[key] ?? "").trim();
    setSavingKey(key);
    setError(null);

    try {
      const response = await fetch(`/api/tasks/${taskId}/subtasks/${unteraufgabeIndex}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ hinweis }),
      });

      const data = (await response.json()) as { task?: UiTask; error?: string };

      if (!response.ok || !data.task) {
        throw new Error(data.error ?? "Hinweis konnte nicht gespeichert werden.");
      }

      setTasks((current) => current.map((task) => (task.id === taskId ? data.task! : task)));
      setHinweisDrafts((current) => {
        const next = { ...current };
        data.task!.unteraufgaben.forEach((item, index) => {
          next[`${taskId}:${index}`] = item.hinweis ?? "";
        });
        return next;
      });
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Unbekannter Fehler";
      setError(message);
    } finally {
      setSavingKey(null);
      setActiveHinweisKey((current) => (current === key ? null : current));
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 px-6 py-10 text-neutral-100">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-5xl flex-col gap-6">
        <header className="rounded-xl bg-neutral-900 p-5 shadow-sm ring-1 ring-neutral-800">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold">HausAufgaben</h1>
              <p className="mt-2 text-sm text-neutral-300">
                WebApp zur anzeige von aktuellen Aufgaben rund ums Grundstück
              </p>
              <div className="mt-3 flex flex-col items-start gap-1">
                {verantwortlichOptionen.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setVerantwortlichFilter(option)}
                    className={`rounded px-2 py-1 text-left text-sm transition ${
                      verantwortlichFilter === option
                        ? "bg-neutral-700 text-neutral-100"
                        : "text-neutral-300 hover:bg-neutral-800"
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
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
                href="/Abgeschlossen"
                className="rounded border border-neutral-700 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-800"
              >
                Abgeschlossen
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
          ) : (
            <div className="space-y-4">
              {filteredTasks.map((task) => (
                <article key={task.id} className={`rounded-xl p-5 shadow-sm ring-1 ${getTaskCardClass(task)}`}>
                  <div className="mb-1 flex items-center justify-between gap-4 text-xs text-neutral-400">
                    <span>
                      {task.stammdaten
                        ? `Haus ${task.stammdaten.hausId} - ${task.stammdaten.typName ?? "Typ"} ${task.stammdaten.bereichId}`
                        : task.summary.felder.Bereich || "Unbekannter Bereich"}
                    </span>
                    <span>Geändert: {formatLastModifiedDe(task.lastModified)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="radio"
                      aria-label="Aufgabenstatus"
                      checked={isTaskCompleted(task)}
                      disabled
                      readOnly
                    />
                    <h2 className="text-lg font-semibold">
                      {task.summary.felder.Titel || "Ohne Titel"}
                    </h2>
                  </div>
                  <p className="text-sm text-neutral-500">Verantwortlich: {task.summary.felder.Verantwortlich || "-"}</p>
                  <p className="text-sm text-neutral-500">Fälligkeit: {formatDateDe(task.due)}</p>

                  {task.stammdaten && (
                    <section className="mt-3 rounded-lg bg-neutral-950 p-3 ring-1 ring-neutral-800">
                      <div className="text-sm text-neutral-300">
                        {task.stammdaten.mieter.length > 0 ? (
                          <div>
                            {task.stammdaten.mieter.map((mieter) => (
                              <p key={mieter.ID}>
                                {mieter.Telefon.trim() ? `${mieter.Name} (${mieter.Telefon})` : mieter.Name}
                              </p>
                            ))}
                          </div>
                        ) : (
                          <p>-</p>
                        )}
                      </div>
                      <div className="text-sm text-neutral-300">
                        {task.stammdaten.adresse ? (
                          <div>
                            <p>{`${task.stammdaten.adresse["Straße"]} ${task.stammdaten.adresse.Hausnummer}`}</p>
                            <p>{`${task.stammdaten.adresse.PLZ} ${task.stammdaten.adresse.Ort}`}</p>
                          </div>
                        ) : (
                          <p>-</p>
                        )}
                      </div>
                    </section>
                  )}

                  <ul className="mt-4 space-y-2">
                    {task.unteraufgaben.map((item, index) => {
                      if (!item.freigegeben) {
                        return null;
                      }

                      const key = `${task.id}:${index}`;
                      const locked = savingKey === key;
                      const hinweisLocked = item.status || locked;
                      const subtaskContainerClass = item.status
                        ? "bg-emerald-950/50 ring-emerald-800"
                        : "bg-neutral-800 ring-neutral-700";
                      const titleClass = "font-medium text-neutral-100";

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
                                void updateUnteraufgabe(
                                  task.id,
                                  index,
                                  !item.status
                                );
                              }}
                              onChange={() => undefined}
                              className="mt-1"
                            />
                            <div>
                              <div className="flex items-center gap-2">
                                <p className={titleClass}>{item.titel}</p>
                                {activeHinweisKey === key ? (
                                  <input
                                    type="text"
                                    value={hinweisDrafts[key] ?? ""}
                                    onChange={(event) =>
                                      setHinweisDrafts((current) => ({ ...current, [key]: event.target.value }))
                                    }
                                    onBlur={() => void updateHinweis(task.id, index)}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter") {
                                        (event.currentTarget as HTMLInputElement).blur();
                                      }
                                    }}
                                    disabled={hinweisLocked}
                                    placeholder="Hinweis"
                                    aria-label="Hinweis"
                                    maxLength={20}
                                    autoFocus
                                    className="w-52 rounded border border-neutral-600 bg-neutral-900 px-2 py-1 text-sm text-neutral-100 disabled:cursor-not-allowed disabled:bg-neutral-800"
                                  />
                                ) : (
                                  <>
                                    {hinweisDrafts[key] && <span className="text-xs text-neutral-400">{hinweisDrafts[key]}</span>}
                                    <button
                                      type="button"
                                      aria-label="Hinweis bearbeiten"
                                      disabled={hinweisLocked}
                                      onClick={() => setActiveHinweisKey(key)}
                                      className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 disabled:cursor-not-allowed disabled:text-neutral-600"
                                    >
                                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                                        <path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
                                        <path d="M14 3v5h5" />
                                      </svg>
                                    </button>
                                  </>
                                )}
                              </div>
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
              <p>Aufgaben: {offeneAufgabenCount}/{tasks.length}</p>
              <p>Unteraufgaben: {offeneCount}/{unteraufgabenCount}</p>
            </div>
          </div>
          <p className="mt-2 text-center text-xs text-neutral-400">&copy; Nils Lüneburg</p>
        </footer>
      </div>
    </div>
  );
}

export default TasksPage;
