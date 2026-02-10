import path from "node:path";

import { NextResponse } from "next/server";

import { stammdatenRepository } from "@/lib/StammDaten";
import { tasks } from "@/lib/Tasks";

function toTaskId(sourceFile?: string): string {
  if (!sourceFile) {
    return "";
  }

  return path.basename(sourceFile, ".ics");
}

export async function GET() {
  try {
    const taskItems = await tasks.readAllTasksFromDirectory();

    const payload = taskItems.map((task) => {
      const bereichBezeichnung = task.summary.felder.Bereich ?? "";
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

      return {
        id: toTaskId(task.sourceFile),
        uid: task.uid,
        status: task.status,
        summary: task.summary,
        unteraufgaben: task.unteraufgaben,
        due: task.due,
        dtStamp: task.dtStamp,
        lastModified: task.properties["LAST-MODIFIED"],
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
      };
    });

    return NextResponse.json({ tasks: payload });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unbekannter Fehler";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
