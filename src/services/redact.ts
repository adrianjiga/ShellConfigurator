import { quoteArgv, splitQuotedArgv } from './args.ts';
import { homeDir } from './paths.ts';

/** Shows the home directory as `~`, so a pasted report does not name the user. */
export function redactHome(text: string, home: string = homeDir()): string {
  if (home.length <= 1) return text;
  const escaped = home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`${escaped}(?![^/\\s\`'":,)\\]])`, 'g'), '~');
}

function redactUrl(value: string): string {
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

function redactUrlText(text: string): string {
  return text.replace(/(\b[a-z][a-z0-9+.-]*:\/\/)([^/\s'"]*@)?([^\s'"?#]*)[^\s'"]*/gi, '$1$3');
}
