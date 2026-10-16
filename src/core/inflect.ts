// Just enough inflection to turn Rails association names into class names
// and class names into readable words.

export function singularize(word: string): string {
  if (/ies$/.test(word)) return word.replace(/ies$/, "y");
  if (/(ss|us|is)$/.test(word)) return word;
  if (/(x|ch|sh|ss)es$/.test(word)) return word.replace(/es$/, "");
  // As Rails does: "statuses" and "buses" drop "es", but "expenses" and "cases" only "s".
  if (/(alias|status|bus)es$/.test(word)) return word.replace(/es$/, "");
  if (/s$/.test(word)) return word.replace(/s$/, "");
  return word;
}

export function camelize(snake: string): string {
  return snake
    .split("/")
    .map((part) =>
      part
        .split("_")
        .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ""))
        .join(""),
    )
    .join("::");
}

export function underscore(name: string): string {
  return name
    .replace(/::/g, "/")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z\d])([A-Z])/g, "$1_$2")
    .toLowerCase();
}

/** "ClientInvitationsController" -> "Client Invitations Controller" */
export function humanize(name: string): string {
  return name
    .replace(/::/g, " ")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2");
}

const ROLE_SUFFIX = /(Controller|Job|Mailer|Helper|Policy|Serializer|Component|Service|Presenter|Decorator|Form|Query|Worker|Concern)$/;

/** The domain word in a class name: Org::ClientInvitationsController -> ClientInvitation. */
export function stem(className: string): string {
  const last = className.split("::").pop() ?? className;
  const bare = last.replace(ROLE_SUFFIX, "") || last;
  const words = bare.match(/[A-Z][a-z\d]*|[A-Z]+(?![a-z])/g) ?? [bare];
  words[words.length - 1] = singularize(words[words.length - 1]);
  return words.join("");
}
