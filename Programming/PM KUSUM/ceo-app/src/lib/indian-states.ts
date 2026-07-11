/** First two digits of GSTIN → Indian state / UT */
export const GST_STATE_CODES: Record<string, string> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
};

export function stateFromGstin(gstin?: string | null): { state: string; stateCode: string } | null {
  const code = gstin?.trim().slice(0, 2);
  if (!code || !GST_STATE_CODES[code]) return null;
  return { stateCode: code, state: GST_STATE_CODES[code] };
}

export function panFromGstin(gstin?: string | null): string | null {
  const g = gstin?.trim().toUpperCase();
  if (!g || g.length < 12) return null;
  const pan = g.slice(2, 12);
  return /^[A-Z]{5}\d{4}[A-Z]$/.test(pan) ? pan : null;
}
