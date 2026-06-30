export type AccountDisplayUser = {
  username: string;
  name?: string | null;
};

export function accountDisplayName(user: AccountDisplayUser): string {
  const name = user.name?.trim();
  return name ? name : `@${user.username}`;
}

export function accountGreetingName(user: AccountDisplayUser): string {
  return user.name?.trim() || user.username;
}
