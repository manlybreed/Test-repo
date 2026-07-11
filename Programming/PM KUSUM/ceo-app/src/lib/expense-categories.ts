export type ExpenseCategory = {
  id: string;
  label: string;
  color: string;
  bg: string;
  icon: string;
  keywords: string[];
};

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  {
    id: "travel",
    label: "Travel",
    color: "#818cf8",
    bg: "rgba(99,102,241,0.12)",
    icon: "✈",
    keywords: ["flight", "air", "indigo", "spicejet", "airline", "train", "irctc", "railway", "bus", "redbus", "cab", "ola", "uber", "taxi", "metro", "travel"],
  },
  {
    id: "food",
    label: "Food & Dining",
    color: "#fb923c",
    bg: "rgba(251,146,60,0.12)",
    icon: "🍽",
    keywords: ["restaurant", "cafe", "hotel dining", "swiggy", "zomato", "food", "meal", "lunch", "dinner", "breakfast", "coffee", "dominos", "pizza", "biryani"],
  },
  {
    id: "accommodation",
    label: "Accommodation",
    color: "#34d399",
    bg: "rgba(16,185,129,0.12)",
    icon: "🏨",
    keywords: ["hotel", "oyo", "makemytrip", "booking.com", "airbnb", "inn", "lodge", "resort", "stay", "room"],
  },
  {
    id: "fuel",
    label: "Fuel",
    color: "#fbbf24",
    bg: "rgba(240,180,41,0.12)",
    icon: "⛽",
    keywords: ["petrol", "diesel", "fuel", "cng", "hp", "bharat petroleum", "indian oil", "iocl", "hpcl", "bpcl", "shell"],
  },
  {
    id: "vendor",
    label: "Vendor Payment",
    color: "#a78bfa",
    bg: "rgba(167,139,250,0.12)",
    icon: "🤝",
    keywords: ["vendor", "supplier", "contractor", "service provider", "invoice", "professional", "consultant"],
  },
  {
    id: "credit_card",
    label: "Credit Card Payment",
    color: "#60a5fa",
    bg: "rgba(96,165,250,0.12)",
    icon: "💳",
    keywords: ["credit card", "hdfc card", "sbi card", "icici card", "axis card", "amex", "card payment", "card bill"],
  },
  {
    id: "salary",
    label: "Salary Payment",
    color: "#4ade80",
    bg: "rgba(74,222,128,0.12)",
    icon: "👤",
    keywords: ["salary", "wages", "payroll", "employee", "staff payment", "compensation"],
  },
  {
    id: "utility_mobile",
    label: "Utility — Mobile",
    color: "#38bdf8",
    bg: "rgba(56,189,248,0.12)",
    icon: "📱",
    keywords: ["airtel", "jio", "bsnl", "vi", "vodafone", "idea", "mobile", "recharge", "postpaid", "prepaid", "telecom", "phone bill"],
  },
  {
    id: "utility_electricity",
    label: "Utility — Electricity",
    color: "#facc15",
    bg: "rgba(250,204,21,0.12)",
    icon: "⚡",
    keywords: ["electricity", "power", "bses", "tata power", "adani electricity", "msedcl", "bescom", "discom", "bijli", "electric bill", "units"],
  },
  {
    id: "utility_internet",
    label: "Utility — Internet",
    color: "#2dd4bf",
    bg: "rgba(45,212,191,0.12)",
    icon: "🌐",
    keywords: ["broadband", "internet", "wifi", "jio fiber", "airtel fiber", "act", "hathway", "tata sky", "bsnl broadband"],
  },
  {
    id: "online_shopping",
    label: "Online Shopping",
    color: "#f472b6",
    bg: "rgba(244,114,182,0.12)",
    icon: "🛍",
    keywords: ["amazon", "flipkart", "myntra", "meesho", "nykaa", "snapdeal", "shopping", "order", "purchase", "delivery"],
  },
  {
    id: "office_supplies",
    label: "Office Supplies",
    color: "#94a3b8",
    bg: "rgba(148,163,184,0.12)",
    icon: "📎",
    keywords: ["stationery", "paper", "printer", "toner", "pen", "office", "supplies", "furniture", "equipment"],
  },
  {
    id: "software",
    label: "Software & Subscriptions",
    color: "#c084fc",
    bg: "rgba(192,132,252,0.12)",
    icon: "💻",
    keywords: ["software", "saas", "subscription", "license", "adobe", "microsoft", "google", "aws", "cloud", "app", "digital"],
  },
  {
    id: "marketing",
    label: "Marketing & Advertising",
    color: "#fb7185",
    bg: "rgba(251,113,133,0.12)",
    icon: "📢",
    keywords: ["advertising", "marketing", "meta ads", "google ads", "social media", "campaign", "promotion", "branding", "print", "banner"],
  },
  {
    id: "medical",
    label: "Medical & Health",
    color: "#f87171",
    bg: "rgba(248,113,113,0.12)",
    icon: "🏥",
    keywords: ["pharmacy", "hospital", "clinic", "doctor", "medical", "medicine", "health", "apollo", "1mg", "netmeds"],
  },
  {
    id: "misc",
    label: "Miscellaneous",
    color: "#6b7280",
    bg: "rgba(107,114,128,0.12)",
    icon: "•",
    keywords: [],
  },
];

export const CATEGORY_MAP = Object.fromEntries(
  EXPENSE_CATEGORIES.map((c) => [c.id, c]),
);

export function getCategoryById(id: string): ExpenseCategory {
  return CATEGORY_MAP[id] ?? CATEGORY_MAP["misc"];
}
