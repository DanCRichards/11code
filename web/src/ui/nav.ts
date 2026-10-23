export type Tab = "live" | "appliances" | "stations" | "log" | "data";

export interface Nav {
  tab: (tab: Tab, filter?: string) => void;
  station: (id: string) => void;
  appliance: (id: string) => void;
}
