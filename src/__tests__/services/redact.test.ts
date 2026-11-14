import { describe, expect, it } from 'vitest';
import { quoteArgv } from '../../services/args.ts';
import { redactHome, redactPersonal, redactUrls } from '../../services/redact.ts';

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
  it.each([
    ['file:///home/ana/x', 'file://~/x'],
    ['a;/home/ana/x|/home/ana<b>{/home/ana}', 'a;~/x|~<b>{~}'],
    ['/srv/people/ana/.zshrc', '/srv/people/ana/.zshrc'],
  ])('finds the home directory after any separator in %s', (text, expected) => {
    expect(redactHome(text, '/home/ana')).toBe(expected);
    expect(redactHome('cd /srv/people/ana/x', '/srv/people/ana')).toBe('cd ~/x');
  });

  it('does not take a longer path that ends with the home path for it', () => {
    expect(redactHome('/data/home/ana/x', '/home/ana')).toBe('/data/home/ana/x');
  });

  it('replaces the home directory when HOME ends in a slash', () => {
    expect(redactHome('/home/ana/.zshrc and /home/ana', '/home/ana/')).toBe('~/.zshrc and ~');
  });

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

describe('redactPersonal', () => {
  it('also shows the user name as <user> where it names another home folder', () => {
    expect(
      redactPersonal(
        'PATH /home/ana/bin:/mnt/c/Users/ana/AppData:/opt/ana-tools /srv/ana /data/home/ana',
        '/home/ana',
        'ana'
      )
    ).toBe('PATH ~/bin:/mnt/c/Users/<user>/AppData:/opt/ana-tools /srv/ana /data/home/<user>');
  });

  it('leaves a folder named like the user elsewhere alone', () => {
    expect(
      redactPersonal('/usr/local/bin https://github.com/local/x', '/home/local', 'local')
    ).toBe('/usr/local/bin https://github.com/local/x');
  });

  it('leaves a one-letter user name alone, which would match too much', () => {
    expect(redactPersonal('/a/b', '/home/a', 'a')).toBe('/a/b');
  });
});
