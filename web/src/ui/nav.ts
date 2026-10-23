export type Tab = "live" | "board" | "appliances" | "stations" | "log" | "data" | "quiz";

export interface Nav {
  tab: (tab: Tab, filter?: string) => void;
  station: (id: string) => void;
  appliance: (id: string) => void;
}
