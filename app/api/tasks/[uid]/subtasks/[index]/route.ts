import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { stammdatenRepository } from "@/lib/StammDaten";
import { UnteraufgabenStatus, tasks } from "@/lib/Tasks";

function isStatusValue(value: unknown): value is UnteraufgabenStatus {
  return typeof value === "boolean";
}

function isValidUid(uid: string): boolean {
  return /^[A-Za-z0-9-]+$/.test(uid);
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ uid: string; index: string }> }
) {
  try {
    const { uid, index } = await context.params;

    if (!isValidUid(uid)) {
      return NextResponse.json({ error: "Ungültige UID" }, { status: 400 });
    }

    const indexNumber = Number(index);

    if (!Number.isInteger(indexNumber) || indexNumber < 0) {
      return NextResponse.json({ error: "Ungültiger Unteraufgaben-Index" }, { status: 400 });
    }

    const body = (await request.json()) as { status?: unknown; hinweis?: unknown };
    const hasStatus = body.status !== undefined;
    const hasHinweis = body.hinweis !== undefined;

    if (!hasStatus && !hasHinweis) {
      return NextResponse.json({ error: "Es muss mindestens ein Feld (status oder hinweis) übergeben werden." }, { status: 400 });
    }

    if (hasStatus && !isStatusValue(body.status)) {
      return NextResponse.json({ error: "Ungültiger Status" }, { status: 400 });
    }

    if (hasHinweis && typeof body.hinweis !== "string") {
      return NextResponse.json({ error: "Ungültiger Hinweis" }, { status: 400 });
    }

    const normalizedHinweis = hasHinweis ? tasks.normalizeHinweis(body.hinweis as string) : undefined;

    const filePath = path.join(process.cwd(), "data/tasks", `${uid}.ics`);
    const updatedTask = await tasks.updateUnteraufgabeInFile(filePath, indexNumber, {
      status: hasStatus ? (body.status as UnteraufgabenStatus) : undefined,
      hinweis: normalizedHinweis,
    });
    const bereichBezeichnung = updatedTask.summary.felder.Bereich ?? "";
    const bereich = stammdatenRepository.getBereichByBezeichnung(bereichBezeichnung);
    const bereichMitRelationen = bereich
      ? stammdatenRepository.getBereichMitRelationenByKey({
          typId: bereich["Typ.ID"],
          bereichId: bereich.ID,
        })
      : undefined;
    const hausMitRelationen = bereich
      ? stammdatenRepository.getHausMitRelationen(bereich["Haus.ID"])
      : undefined;

    return NextResponse.json({
      task: {
        id: uid,
        uid: updatedTask.uid,
        status: updatedTask.status,
        summary: updatedTask.summary,
        unteraufgaben: updatedTask.unteraufgaben,
        due: updatedTask.due,
        dtStamp: updatedTask.dtStamp,
        lastModified: updatedTask.properties["LAST-MODIFIED"],
        completed: updatedTask.properties.COMPLETED,
        percentComplete: updatedTask.properties["PERCENT-COMPLETE"],
        stammdaten: bereich
          ? {
              typName: bereichMitRelationen?.typ?.Name,
              bereichId: bereich.ID,
              hausId: bereich["Haus.ID"],
              eingang: bereich.Eingang,
              lage: bereich.Lage,
              adresse: hausMitRelationen?.adresse,
              mieter: bereichMitRelationen?.mieter ?? [],
            }
          : null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unbekannter Fehler";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
