import { describe, expect, it } from 'vitest';
import { quoteArgv } from '../../services/args.ts';
import { redactHome, redactUrls } from '../../services/redact.ts';

describe('redactUrls', () => {
  it('drops the credentials, query and fragment of a URL', () => {
    expect(
      redactUrls(
        "apply --import-url 'https://ana:ghp_secret@gist.githubusercontent.com/ana/raw/s.toml?token=abc#x' --shells zsh"
      )
    ).toBe('apply --import-url https://gist.githubusercontent.com/ana/raw/s.toml --shells zsh');
  });

  it('drops credentials that contain a quote, as quoteArgv recorded them', () => {
    const recorded = quoteArgv([
      'apply',
      '--import-url',
      "https://ana:p'w@d@example.com/s.toml?token=abc",
      '--shells',
      'zsh',
    ]);
    const redacted = redactUrls(recorded);

    expect(redacted).toBe(
      quoteArgv(['apply', '--import-url', 'https://example.com/s.toml', '--shells', 'zsh'])
    );
    expect(redacted).not.toContain('ana');
  });

  it('drops credentials from a --flag=value URL', () => {
    expect(redactUrls(quoteArgv(['apply', '--import-url=https://u:tok@example.com/a?b=1']))).toBe(
      quoteArgv(['apply', '--import-url=https://example.com/a'])
    );
  });

  it('leaves a command without URLs alone', () => {
    expect(redactUrls('apply --state card.json')).toBe('apply --state card.json');
  });
});

describe('redactHome', () => {
  it('replaces every occurrence of the home directory', () => {
    expect(redactHome('/home/ana/.zshrc and /home/ana/.bashrc', '/home/ana')).toBe(
      '~/.zshrc and ~/.bashrc'
    );
  });

  it('only replaces the home directory itself, not a longer name that starts with it', () => {
    expect(
      redactHome('/home/al/.zshrc /home/alex/bin `/home/al` "/home/al",x /home/al', '/home/al')
    ).toBe('~/.zshrc /home/alex/bin `~` "~",x ~');
    expect(redactHome('/root/bin:/rootfs/bin', '/root')).toBe('~/bin:/rootfs/bin');
  });

  it('leaves text alone when home is the root directory', () => {
    expect(redactHome('/etc/shells', '/')).toBe('/etc/shells');
  });
});
