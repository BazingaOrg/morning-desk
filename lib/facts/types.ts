export type FactKind =
  | "8-K"
  | "10-Q"
  | "10-K"
  | "S-1"
  | "425"
  | "DEFA14A"
  | "6-K"
  | "20-F"
  | "HK公告"
  | "董事会会议"
  | "股东大会"
  | "财报窗口";

export interface FactDoc {
  id: string;
  kind: FactKind;
  title: string;
  eventDate: string;
  catalystDate?: string;
  href: string;
  official: boolean;
}

export interface FactBundle {
  docs: FactDoc[];
  sourcesUsed: string[];
  gaps: string[];
}
