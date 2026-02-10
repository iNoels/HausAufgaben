import fs from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type UnteraufgabenStatus = boolean;

export interface TaskModifierConfig {
  descriptionTrennzeichen: string;
  hinweisTrennzeichen?: string;
  statusSymbole: {
    nichtBegonnen: { freigegeben: string; gesperrt: string };
    erledigt: { freigegeben: string; gesperrt: string };
  };
  summaryTrennzeichen: string;
  summaryInhalt: string[];
}

export interface ParsedUnteraufgabe {
  symbol: string;
  status: UnteraufgabenStatus;
  freigegeben: boolean;
  titel: string;
  hinweis?: string;
  raw: string;
}

export interface ParsedSummary {
  raw: string;
  teile: string[];
  felder: Record<string, string>;
}

export interface ParsedTask {
  sourceFile?: string;
  uid?: string;
  created?: string;
  dtStamp?: string;
  due?: string;
  start?: string;
  status?: string;
  summary: ParsedSummary;
  descriptionRaw: string;
  unteraufgaben: ParsedUnteraufgabe[];
  properties: Record<string, string>;
}

export interface UnteraufgabeUpdateInput {
  titel: string;
  status: UnteraufgabenStatus;
  freigegeben?: boolean;
  hinweis?: string;
}

interface ModifierRoot {
  Description?: {
    Trennzeichen?: string;
    HinweisTrennzeichen?: string;
    UnterAufgabenStatus?: {
      NichtBegonnen?: { Freigegeben?: string; Gesperrt?: string };
      Erledigt?: { Freigegeben?: string; Gesperrt?: string };
    };
  };
  Summary?: {
    Trennzeichen?: string;
    Inhalt?: string[];
  };
}

export class Tasks {
  private modifierConfig!: TaskModifierConfig;
  private readonly modifierSourceFilePath: string;
  private cachedModifierMtimeMs = -1;

  constructor(modifierSourceFilePath = path.join(process.cwd(), "data/config/Modifier.json")) {
    this.modifierSourceFilePath = modifierSourceFilePath;
    this.reloadModifierIfNeeded(true);
  }

  get modifier(): TaskModifierConfig {
    this.reloadModifierIfNeeded();
    return this.modifierConfig;
  }

  async readAllTasksFromDirectory(directoryPath = path.join(process.cwd(), "data/tasks")): Promise<ParsedTask[]> {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    const icsFiles = entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".ics"))
      .map((entry) => path.join(directoryPath, entry.name))
      .sort();

    const tasks = await Promise.all(icsFiles.map((filePath) => this.readTaskFromFile(filePath)));
    return tasks;
  }

  async readTaskFromFile(filePath: string): Promise<ParsedTask> {
    const content = await readFile(filePath, "utf8");
    return this.parseTaskFromIcsContent(content, filePath);
  }

  async setUnteraufgabeStatusInFile(
    filePath: string,
    unteraufgabeIndex: number,
    status: UnteraufgabenStatus
  ): Promise<ParsedTask> {
    return this.updateUnteraufgabeInFile(filePath, unteraufgabeIndex, { status });
  }

  async setUnteraufgabeHinweisInFile(
    filePath: string,
    unteraufgabeIndex: number,
    hinweis: string
  ): Promise<ParsedTask> {
    return this.updateUnteraufgabeInFile(filePath, unteraufgabeIndex, { hinweis });
  }

  normalizeHinweis(hinweis: string): string {
    let normalized = hinweis.normalize("NFKC").replace(/[\u0000-\u001F\u007F]/g, " ");

    for (const token of this.getSteuerzeichenTokens()) {
      normalized = normalized.split(token).join(" ");
    }

    normalized = normalized.replace(/\s+/g, " ").trim();

    if (normalized.length > 20) {
      normalized = normalized.slice(0, 20).trimEnd();
    }

    return normalized;
  }

  async updateUnteraufgabeInFile(
    filePath: string,
    unteraufgabeIndex: number,
    patch: { status?: UnteraufgabenStatus; hinweis?: string }
  ): Promise<ParsedTask> {
    const parsed = await this.readTaskFromFile(filePath);
    const unteraufgaben: UnteraufgabeUpdateInput[] = parsed.unteraufgaben.map((item) => ({
      titel: item.titel,
      status: item.status,
      freigegeben: item.freigegeben,
      hinweis: item.hinweis,
    }));

    if (unteraufgabeIndex < 0 || unteraufgabeIndex >= unteraufgaben.length) {
      throw new Error(`Unteraufgabe Index ${unteraufgabeIndex} ist außerhalb des gültigen Bereichs.`);
    }

    const nextHinweis =
      patch.hinweis === undefined
        ? unteraufgaben[unteraufgabeIndex].hinweis
        : this.normalizeHinweis(patch.hinweis);

    unteraufgaben[unteraufgabeIndex] = {
      ...unteraufgaben[unteraufgabeIndex],
      status: patch.status ?? unteraufgaben[unteraufgabeIndex].status,
      hinweis: nextHinweis ? nextHinweis : undefined,
    };

    return this.writeUnteraufgabenToFile(filePath, unteraufgaben);
  }

  async writeUnteraufgabenToFile(
    filePath: string,
    unteraufgaben: UnteraufgabeUpdateInput[]
  ): Promise<ParsedTask> {
    const content = await readFile(filePath, "utf8");
    const newline = content.includes("\r\n") ? "\r\n" : "\n";
    const unfoldedLines = this.unfoldIcsLines(content);
    const vtodoBounds = this.getVtodoBounds(unfoldedLines);

    if (!vtodoBounds) {
      throw new Error("Keine VTODO-Komponente in der ICS-Datei gefunden.");
    }

    const nowUtc = this.toUtcTimestamp(new Date());
    const vtodoLines = unfoldedLines.slice(vtodoBounds.begin + 1, vtodoBounds.end);
    const descriptionValue = this.buildDescriptionValue(unteraufgaben);

    this.upsertProperty(vtodoLines, "DESCRIPTION", this.escapeIcsText(descriptionValue));
    this.upsertProperty(vtodoLines, "DTSTAMP", nowUtc);
    this.upsertProperty(vtodoLines, "LAST-MODIFIED", nowUtc);

    const updatedLines = [
      ...unfoldedLines.slice(0, vtodoBounds.begin + 1),
      ...vtodoLines,
      ...unfoldedLines.slice(vtodoBounds.end),
    ];
    const updatedContent = `${updatedLines.join(newline)}${newline}`;

    await writeFile(filePath, updatedContent, "utf8");
    return this.parseTaskFromIcsContent(updatedContent, filePath);
  }

  parseTaskFromIcsContent(content: string, sourceFile?: string): ParsedTask {
    const props = this.parseIcsProperties(content);
    const summaryRaw = props.SUMMARY ?? "";
    const descriptionRaw = props.DESCRIPTION ?? "";

    return {
      sourceFile,
      uid: props.UID,
      created: props.CREATED,
      dtStamp: props.DTSTAMP,
      due: props.DUE,
      start: props.DTSTART,
      status: props.STATUS,
      summary: this.parseSummary(summaryRaw),
      descriptionRaw,
      unteraufgaben: this.parseUnteraufgaben(descriptionRaw),
      properties: props,
    };
  }

  private parseSummary(summaryRaw: string): ParsedSummary {
    const teile = summaryRaw
      .split(this.modifier.summaryTrennzeichen)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

    const felder = this.modifier.summaryInhalt.reduce<Record<string, string>>((acc, key, index) => {
      acc[key] = teile[index] ?? "";
      return acc;
    }, {});

    return {
      raw: summaryRaw,
      teile,
      felder,
    };
  }

  private buildDescriptionValue(unteraufgaben: UnteraufgabeUpdateInput[]): string {
    return unteraufgaben
      .map((item) => {
        const inhalt = this.buildUnteraufgabeText(item);
        return `${this.toSymbol(item.status, item.freigegeben ?? true)} ${inhalt}`.trim();
      })
      .join(this.modifier.descriptionTrennzeichen);
  }

  private buildUnteraufgabeText(item: UnteraufgabeUpdateInput): string {
    const titel = item.titel.trim();
    const hinweis = (item.hinweis ?? "").trim();
    const separator = this.getHinweisSeparator();

    if (!hinweis || !separator) {
      return titel;
    }

    return `${titel}${separator}${hinweis}`;
  }

  private parseUnteraufgaben(descriptionRaw: string): ParsedUnteraufgabe[] {
    const text = descriptionRaw.replace(/\\n/g, "\n").replace(/\r\n/g, "\n").trim();

    if (!text) {
      return [];
    }

    const newLineSeparator = this.modifier.descriptionTrennzeichen.includes("\n")
      ? /\s*\n\s*/
      : new RegExp(this.escapeRegex(this.modifier.descriptionTrennzeichen));

    return text
      .split(newLineSeparator)
      .map((rawPart) => rawPart.trim())
      .filter((rawPart) => rawPart.length > 0)
      .map((rawPart) => {
        const parsedPrefix = this.parseStatusPrefix(rawPart);
        const splitText = this.splitTitelUndHinweis(parsedPrefix.inhalt);

        return {
          symbol: parsedPrefix.symbol,
          status: parsedPrefix.status,
          freigegeben: parsedPrefix.freigegeben,
          titel: splitText.titel,
          hinweis: splitText.hinweis,
          raw: rawPart,
        };
      });
  }

  private parseStatusPrefix(rawPart: string): {
    symbol: string;
    status: UnteraufgabenStatus;
    freigegeben: boolean;
    inhalt: string;
  } {
    const candidates: Array<{ symbol: string; status: UnteraufgabenStatus; freigegeben: boolean }> = [
      {
        symbol: this.modifier.statusSymbole.nichtBegonnen.gesperrt,
        status: false,
        freigegeben: false,
      },
      {
        symbol: this.modifier.statusSymbole.erledigt.gesperrt,
        status: true,
        freigegeben: false,
      },
      {
        symbol: this.modifier.statusSymbole.nichtBegonnen.freigegeben,
        status: false,
        freigegeben: true,
      },
      {
        symbol: this.modifier.statusSymbole.erledigt.freigegeben,
        status: true,
        freigegeben: true,
      },
    ].sort((a, b) => b.symbol.length - a.symbol.length);

    for (const candidate of candidates) {
      if (rawPart.startsWith(candidate.symbol)) {
        return {
          symbol: candidate.symbol,
          status: candidate.status,
          freigegeben: candidate.freigegeben,
          inhalt: rawPart.slice(candidate.symbol.length).trim(),
        };
      }
    }

    return {
      symbol: "",
      status: false,
      freigegeben: true,
      inhalt: rawPart.trim(),
    };
  }

  private splitTitelUndHinweis(text: string): { titel: string; hinweis?: string } {
    const separator = this.getHinweisSeparator();

    if (!separator) {
      return { titel: text.trim() };
    }

    const separatorIndex = text.indexOf(separator);

    if (separatorIndex < 0) {
      return { titel: text.trim() };
    }

    const titel = text.slice(0, separatorIndex).trim();
    const hinweis = this.normalizeHinweis(text.slice(separatorIndex + separator.length));

    return {
      titel,
      hinweis: hinweis || undefined,
    };
  }

  private getHinweisSeparator(): string | undefined {
    const raw = this.modifier.hinweisTrennzeichen?.trim();

    if (!raw) {
      return undefined;
    }

    return ` ${raw} `;
  }

  private getSteuerzeichenTokens(): string[] {
    const tokens = [
      this.modifier.statusSymbole.nichtBegonnen.freigegeben,
      this.modifier.statusSymbole.nichtBegonnen.gesperrt,
      this.modifier.statusSymbole.erledigt.freigegeben,
      this.modifier.statusSymbole.erledigt.gesperrt,
      this.modifier.hinweisTrennzeichen?.trim(),
      this.modifier.descriptionTrennzeichen,
    ]
      .filter((token): token is string => Boolean(token))
      .sort((a, b) => b.length - a.length);

    return tokens;
  }

  private toSymbol(status: UnteraufgabenStatus, freigegeben: boolean): string {
    if (!status && !freigegeben) {
      return this.modifier.statusSymbole.nichtBegonnen.gesperrt;
    }

    if (status && !freigegeben) {
      return this.modifier.statusSymbole.erledigt.gesperrt;
    }

    if (!status) {
      return this.modifier.statusSymbole.nichtBegonnen.freigegeben;
    }

    return this.modifier.statusSymbole.erledigt.freigegeben;
  }

  private parseIcsProperties(content: string): Record<string, string> {
    const unfoldedLines = this.unfoldIcsLines(content);
    const inVtodo: string[] = [];
    let insideVtodo = false;

    for (const line of unfoldedLines) {
      if (line === "BEGIN:VTODO") {
        insideVtodo = true;
        continue;
      }

      if (line === "END:VTODO") {
        break;
      }

      if (insideVtodo) {
        inVtodo.push(line);
      }
    }

    const props: Record<string, string> = {};

    for (const line of inVtodo) {
      const separatorIndex = line.indexOf(":");

      if (separatorIndex <= 0) {
        continue;
      }

      const left = line.slice(0, separatorIndex);
      const value = line.slice(separatorIndex + 1);
      const key = left.split(";", 1)[0].toUpperCase();

      props[key] = this.unescapeIcsText(value);
    }

    return props;
  }

  private getVtodoBounds(lines: string[]): { begin: number; end: number } | null {
    const begin = lines.findIndex((line) => line === "BEGIN:VTODO");

    if (begin < 0) {
      return null;
    }

    const end = lines.findIndex((line, index) => index > begin && line === "END:VTODO");

    if (end < 0) {
      return null;
    }

    return { begin, end };
  }

  private upsertProperty(lines: string[], key: string, value: string): void {
    const keyUpper = key.toUpperCase();
    const index = lines.findIndex((line) => {
      const separatorIndex = line.indexOf(":");

      if (separatorIndex <= 0) {
        return false;
      }

      const left = line.slice(0, separatorIndex);
      const lineKey = left.split(";", 1)[0].toUpperCase();
      return lineKey === keyUpper;
    });

    const newLine = `${keyUpper}:${value}`;

    if (index >= 0) {
      lines[index] = newLine;
      return;
    }

    lines.push(newLine);
  }

  private unfoldIcsLines(content: string): string[] {
    const lines = content.replace(/\r\n/g, "\n").split("\n");
    const unfolded: string[] = [];

    for (const line of lines) {
      if ((line.startsWith(" ") || line.startsWith("\t")) && unfolded.length > 0) {
        unfolded[unfolded.length - 1] += line.slice(1);
      } else {
        unfolded.push(line);
      }
    }

    return unfolded;
  }

  private unescapeIcsText(value: string): string {
    return value
      .replace(/\\n/gi, "\n")
      .replace(/\\,/g, ",")
      .replace(/\\;/g, ";")
      .replace(/\\\\/g, "\\");
  }

  private escapeIcsText(value: string): string {
    return value
      .replace(/\\/g, "\\\\")
      .replace(/\n/g, "\\n")
      .replace(/,/g, "\\,")
      .replace(/;/g, "\\;");
  }

  private toUtcTimestamp(date: Date): string {
    const pad = (value: number) => String(value).padStart(2, "0");

    return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(
      date.getUTCHours()
    )}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
  }

  private readModifierConfig(modifier: ModifierRoot | undefined): TaskModifierConfig {
    const description = modifier?.Description;
    const summary = modifier?.Summary;

    return {
      descriptionTrennzeichen: description?.Trennzeichen ?? "\n",
      hinweisTrennzeichen: description?.HinweisTrennzeichen ?? "##",
      statusSymbole: {
        nichtBegonnen: {
          freigegeben: description?.UnterAufgabenStatus?.NichtBegonnen?.Freigegeben ?? "*",
          gesperrt: description?.UnterAufgabenStatus?.NichtBegonnen?.Gesperrt ?? ".*",
        },
        erledigt: {
          freigegeben: description?.UnterAufgabenStatus?.Erledigt?.Freigegeben ?? "✓",
          gesperrt: description?.UnterAufgabenStatus?.Erledigt?.Gesperrt ?? ".✓",
        },
      },
      summaryTrennzeichen: summary?.Trennzeichen ?? "//",
      summaryInhalt: summary?.Inhalt ?? [],
    };
  }

  private reloadModifierIfNeeded(force = false): void {
    const stat = fs.statSync(this.modifierSourceFilePath);
    const nextMtimeMs = stat.mtimeMs;

    if (!force && nextMtimeMs === this.cachedModifierMtimeMs) {
      return;
    }

    const content = fs.readFileSync(this.modifierSourceFilePath, "utf-8");
    const parsed = JSON.parse(content) as { Modifier?: ModifierRoot };
    this.modifierConfig = this.readModifierConfig(parsed.Modifier);
    this.cachedModifierMtimeMs = nextMtimeMs;
  }

  private escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}

export const tasks = new Tasks();
