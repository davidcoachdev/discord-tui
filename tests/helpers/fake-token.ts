export function fakeToken(seed = "a"): string {
  return ["MTAw".repeat(6), "G" + seed.repeat(5), "z".repeat(30)].join(".");
}
