declare module "command-score" {
  /** Fuzzy-match score in [0, 1] — 0 means no match, 1 means a perfect/prefix match. */
  function commandScore(target: string, abbreviation: string): number;
  export default commandScore;
}
