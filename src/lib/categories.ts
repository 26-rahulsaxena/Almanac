// Colour categories are Google's own event colours (colorId 1–11), so they also show in Google Calendar.
// shortcut: category names are Google's colour names; add a per-user names table when you want "Work", "Exams" etc.
export const CATEGORIES = [
  { id: "1", name: "Lavender", hex: "#7986cb" },
  { id: "2", name: "Sage", hex: "#33b679" },
  { id: "3", name: "Grape", hex: "#8e24aa" },
  { id: "4", name: "Flamingo", hex: "#e67c73" },
  { id: "5", name: "Banana", hex: "#f6bf26" },
  { id: "6", name: "Tangerine", hex: "#f4511e" },
  { id: "7", name: "Peacock", hex: "#039be5" },
  { id: "8", name: "Graphite", hex: "#616161" },
  { id: "9", name: "Blueberry", hex: "#3f51b5" },
  { id: "10", name: "Basil", hex: "#0b8043" },
  { id: "11", name: "Tomato", hex: "#d50000" },
];

export const categoryHex = (id?: string | null) => CATEGORIES.find((c) => c.id === id)?.hex;
