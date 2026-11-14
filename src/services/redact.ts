import * as os from 'node:os';
import { quoteArgv, splitQuotedArgv } from './args.ts';
import { homeDir } from './paths.ts';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Shows the home directory as `~`, so a pasted report does not name the user. */
export function redactHome(text: string, home: string = homeDir()): string {
  const trimmed = home.replace(/\/+$/, '');
  if (trimmed.length <= 1) return text;
  return text.replace(new RegExp(`(?<![\\w.~-])${escapeRegExp(trimmed)}(?![\\w.~-])`, 'g'), '~');
}

function currentUser(): string {
  try {
    return os.userInfo().username;
  } catch {
    return '';
  }
}

/**
 * Shows the user name as `<user>` where it names a home folder other than this
 * one, such as WSL's `/mnt/c/Users/<name>` or a second `/home/<name>`.
 */
export function redactUser(text: string, user: string = currentUser()): string {
  if (user.length < 2) return text;
  return text.replace(
    new RegExp(`(?<=/(?:[Uu]sers|home)/)${escapeRegExp(user)}(?![\\w.~-])`, 'g'),
    '<user>'
  );
}

/** The home folder as `~` and the user name as `<user>`, for text meant for a public issue. */
export function redactPersonal(text: string, home?: string, user?: string): string {
  return redactUser(redactHome(text, home), user);
}

/** One URL without its credentials, query and fragment. */
export function redactUrl(value: string): string {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return redactUrlText(value);
  }
}

/**
 * Hides the credentials, query and fragment of every URL in a recorded
 * command, where tokens travel. Each argument (or `--flag=value` value) is
 * parsed as a URL, so quoting inside a password cannot hide it.
 */
export function redactUrls(command: string): string {
  const argv = splitQuotedArgv(command);
  if (!argv) return redactUrlText(command);
  return quoteArgv(
    argv.map((arg) => {
      const eq = arg.startsWith('-') ? arg.indexOf('=') : -1;
      return eq === -1 ? redactUrl(arg) : `${arg.slice(0, eq + 1)}${redactUrl(arg.slice(eq + 1))}`;
    })
  );
}

/** Every URL in free text without its credentials, query and fragment. */
export function redactUrlText(text: string): string {
  return text.replace(/(\b[a-z][a-z0-9+.-]*:\/\/)([^/\s'"]*@)?([^\s'"?#]*)[^\s'"]*/gi, '$1$3');
}
