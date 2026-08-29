export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;

  const now = new Date();
  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (isToday) {
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  }

  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "2-digit",
    year: "numeric",
  });
}

export function formatExpenseDate(dateStr: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  if (!match) return dateStr;

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month ||
    date.getDate() !== day
  ) {
    return dateStr;
  }

  const now = new Date();
  if (
    year === now.getFullYear() &&
    month === now.getMonth() &&
    day === now.getDate()
  ) {
    return "Today";
  }

  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "2-digit",
    year: "numeric",
  });
}
