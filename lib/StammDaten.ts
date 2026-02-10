import fs from "node:fs";
import path from "node:path";

export interface AdresseDatensatz {
  ID: number;
  "Straße": string;
  Hausnummer: string;
  PLZ: string;
  Ort: string;
}

export interface PersonDatensatz {
  ID: number;
  Name: string;
  Telefon: string;
}

export interface TypDatensatz {
  ID: number;
  Name: string;
}

export interface HausDatensatz {
  "Typ.ID": number;
  ID: number;
  "Adresse.ID": number;
}

export interface BereichDatensatz {
  "Typ.ID": number;
  ID: number;
  "Haus.ID": number;
  Eingang: string;
  Lage: string;
  "Person.ID": number[];
}

export interface BereichKey {
  typId: number;
  bereichId: number;
}

export interface StammdatenBereich {
  Adresse: AdresseDatensatz[];
  Person: PersonDatensatz[];
  Typ: TypDatensatz[];
  Haus: HausDatensatz[];
  Bereich: BereichDatensatz[];
}

export interface StammdatenDatei {
  Stammdaten: StammdatenBereich;
}

export interface BereichMitRelationen {
  bereich: BereichDatensatz;
  haus?: HausDatensatz;
  typ?: TypDatensatz;
  mieter: PersonDatensatz[];
}

export interface HausMitRelationen {
  haus: HausDatensatz;
  adresse?: AdresseDatensatz;
  typ?: TypDatensatz;
  bereiche: BereichMitRelationen[];
}

export class StammdatenRepository {
  private data!: StammdatenDatei;
  private readonly sourceFilePath: string;
  private cachedMtimeMs = -1;
  private readonly adresseById = new Map<number, AdresseDatensatz>();
  private readonly personById = new Map<number, PersonDatensatz>();
  private readonly typById = new Map<number, TypDatensatz>();
  private readonly typByName = new Map<string, TypDatensatz>();
  private readonly hausById = new Map<number, HausDatensatz>();
  private readonly bereichByKey = new Map<string, BereichDatensatz>();

  constructor(sourceFilePath = path.join(process.cwd(), "data/config/StammDaten.json")) {
    this.sourceFilePath = sourceFilePath;
    this.reloadIfNeeded(true);
  }

  getStammdaten(): StammdatenBereich {
    this.reloadIfNeeded();
    return this.data.Stammdaten;
  }

  getHausById(hausId: number): HausDatensatz | undefined {
    this.reloadIfNeeded();
    return this.hausById.get(hausId);
  }

  getBereichByKey(key: BereichKey): BereichDatensatz | undefined {
    this.reloadIfNeeded();
    return this.bereichByKey.get(this.bereichKey(key));
  }

  getBereichById(typId: number, bereichId: number): BereichDatensatz | undefined {
    return this.getBereichByKey({ typId, bereichId });
  }

  getBereichByTypNameUndId(typName: string, bereichId: number): BereichDatensatz | undefined {
    this.reloadIfNeeded();
    const typ = this.typByName.get(this.normalizeTypName(typName));

    if (!typ) {
      return undefined;
    }

    return this.getBereichByKey({ typId: typ.ID, bereichId });
  }

  getBereichByBezeichnung(bezeichnung: string): BereichDatensatz | undefined {
    this.reloadIfNeeded();
    const normalized = bezeichnung
      .trim()
      .replace(/\s+/g, " ")
      .replace(/[)"']+$/g, "");
    const segment = normalized.includes("-") ? normalized.split("-").pop()?.trim() ?? normalized : normalized;
    const match = segment.match(/^(.*)\s+(\d+)$/);

    if (!match) {
      return undefined;
    }

    const [, typName, bereichId] = match;
    return this.getBereichByTypNameUndId(typName, Number(bereichId));
  }

  getBereicheByHausId(hausId: number): BereichDatensatz[] {
    this.reloadIfNeeded();
    return this.data.Stammdaten.Bereich.filter((bereich) => bereich["Haus.ID"] === hausId);
  }

  getBereicheByPersonId(personId: number): BereichDatensatz[] {
    this.reloadIfNeeded();
    return this.data.Stammdaten.Bereich.filter((bereich) =>
      bereich["Person.ID"].includes(personId)
    );
  }

  getBereichMitRelationenByKey(key: BereichKey): BereichMitRelationen | undefined {
    this.reloadIfNeeded();
    const bereich = this.getBereichByKey(key);

    if (!bereich) {
      return undefined;
    }

    return this.resolveBereich(bereich);
  }

  getBereichMitRelationen(typId: number, bereichId: number): BereichMitRelationen | undefined {
    return this.getBereichMitRelationenByKey({ typId, bereichId });
  }

  getHausMitRelationen(hausId: number): HausMitRelationen | undefined {
    this.reloadIfNeeded();
    const haus = this.getHausById(hausId);

    if (!haus) {
      return undefined;
    }

    return {
      haus,
      adresse: this.adresseById.get(haus["Adresse.ID"]),
      typ: this.typById.get(haus["Typ.ID"]),
      bereiche: this.getBereicheByHausId(hausId).map((bereich) => this.resolveBereich(bereich)),
    };
  }

  private reloadIfNeeded(force = false): void {
    const stat = fs.statSync(this.sourceFilePath);
    const nextMtimeMs = stat.mtimeMs;

    if (!force && nextMtimeMs === this.cachedMtimeMs) {
      return;
    }

    const fileContent = fs.readFileSync(this.sourceFilePath, "utf-8");
    const parsed = JSON.parse(fileContent) as StammdatenDatei;

    this.data = parsed;
    this.cachedMtimeMs = nextMtimeMs;
    this.rebuildIndexes();
  }

  private rebuildIndexes(): void {
    this.adresseById.clear();
    this.personById.clear();
    this.typById.clear();
    this.typByName.clear();
    this.hausById.clear();
    this.bereichByKey.clear();

    const stammdaten = this.data.Stammdaten;

    stammdaten.Adresse.forEach((adresse) => this.adresseById.set(adresse.ID, adresse));
    stammdaten.Person.forEach((person) => this.personById.set(person.ID, person));
    stammdaten.Typ.forEach((typ) => {
      this.typById.set(typ.ID, typ);
      this.typByName.set(this.normalizeTypName(typ.Name), typ);
    });
    stammdaten.Haus.forEach((haus) => this.hausById.set(haus.ID, haus));
    stammdaten.Bereich.forEach((bereich) => {
      this.bereichByKey.set(
        this.bereichKey({ typId: bereich["Typ.ID"], bereichId: bereich.ID }),
        bereich
      );
    });
  }

  private resolveBereich(bereich: BereichDatensatz): BereichMitRelationen {
    return {
      bereich,
      haus: this.hausById.get(bereich["Haus.ID"]),
      typ: this.typById.get(bereich["Typ.ID"]),
      mieter: bereich["Person.ID"]
        .map((personId) => this.personById.get(personId))
        .filter((person): person is PersonDatensatz => Boolean(person)),
    };
  }

  private bereichKey(key: BereichKey): string {
    return `${key.typId}:${key.bereichId}`;
  }

  private normalizeTypName(typName: string): string {
    return typName.trim().toLowerCase();
  }
}

export const stammdatenRepository = new StammdatenRepository();
