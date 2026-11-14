import type { Subcommand } from './args.ts';
import {
  type CompletionShell,
  type FlagInfo,
  GLOBAL_FLAGS,
  SUBCOMMAND_INFO,
  WIZARD_FLAGS,
} from './cliSurface.ts';

const COMMAND = 'shell-configurator';
const FN = '_shell_configurator';
/** zsh names an autoloaded completion function after its file, `_shell-configurator`. */
const ZSH_FN = '_shell-configurator';

const SUBCOMMANDS = Object.keys(SUBCOMMAND_INFO) as Subcommand[];

/** Every flag spelling a word could be: the long name and any short alias. */
function spellings(flag: FlagInfo): string[] {
  return flag.short ? [flag.name, flag.short] : [flag.name];
}

function flagsOf(sub: Subcommand | null): readonly FlagInfo[] {
  return sub === null
    ? [...WIZARD_FLAGS, ...GLOBAL_FLAGS]
    : [...SUBCOMMAND_INFO[sub].flags, ...GLOBAL_FLAGS];
}

const valued = (flags: readonly FlagInfo[]) => flags.filter((f) => f.values !== undefined);

function bash(): string {
  const valueCases = [null, ...SUBCOMMANDS].flatMap((sub) =>
    valued(flagsOf(sub)).map((flag) => {
      const pattern = spellings(flag)
        .map((s) => `${sub ?? ''}:${s}`)
        .join('|');
      if (flag.values === 'file') {
        return `    ${pattern}) compopt -o filenames 2>/dev/null; local IFS=$'\\n'; COMPREPLY=($(compgen -f -- "$cur")); return ;;`;
      }
      if (flag.values === 'text') return `    ${pattern}) COMPREPLY=(); return ;;`;
      const words = (flag.values as readonly string[]).join(' ');
      if (flag.name === '--shells') {
        return `    ${pattern}) local pre=""; [[ $cur == *,* ]] && pre="\${cur%,*},"; compopt -o nospace 2>/dev/null; COMPREPLY=($(compgen -P "$pre" -W "${words}" -- "\${cur##*,}")); return ;;`;
      }
      return `    ${pattern}) COMPREPLY=($(compgen -W "${words}" -- "$cur")); return ;;`;
    })
  );
  const wordCases = SUBCOMMANDS.map((sub) => {
    const info = SUBCOMMAND_INFO[sub];
    if (info.argument) {
      return `    ${sub}) words=""; (( COMP_CWORD - i == 1 )) && words="${info.argument.join(' ')}" ;;`;
    }
    return `    ${sub}) words="${flagsOf(sub).flatMap(spellings).join(' ')}" ;;`;
  });
  const top = [...SUBCOMMANDS, ...flagsOf(null).flatMap(spellings)].join(' ');
  return `# bash completion for ${COMMAND}
${FN}() {
  local cur prev sub="" words i
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  for ((i = 1; i < COMP_CWORD; i++)); do
    case "\${COMP_WORDS[i]}" in
      ${SUBCOMMANDS.join('|')}) sub="\${COMP_WORDS[i]}"; break ;;
    esac
  done
  case "$sub:$prev" in
${valueCases.join('\n')}
  esac
  case "$sub" in
${wordCases.join('\n')}
    *) words="${top}" ;;
  esac
  COMPREPLY=($(compgen -W "$words" -- "$cur"))
}
complete -F ${FN} ${COMMAND}
`;
}

const zshItem = (name: string, description: string) =>
  `'${name.replace(/:/g, '\\:')}:${description.replace(/'/g, "'\\''")}'`;

function zsh(): string {
  const valueCases = [null, ...SUBCOMMANDS].flatMap((sub) =>
    valued(flagsOf(sub)).map((flag) => {
      const pattern = spellings(flag)
        .map((s) => `${sub ?? ''}:${s}`)
        .join('|');
      if (flag.values === 'file') return `    (${pattern}) _files; return ;;`;
      if (flag.values === 'text') return `    (${pattern}) _message 'value'; return ;;`;
      const words = (flag.values as readonly string[]).join(' ');
      if (flag.name === '--shells')
        return `    (${pattern}) _values -s , 'shell' ${words}; return ;;`;
      return `    (${pattern}) compadd -- ${words}; return ;;`;
    })
  );
  const itemCases = SUBCOMMANDS.map((sub) => {
    const info = SUBCOMMAND_INFO[sub];
    if (info.argument) {
      const items = info.argument.map((value) => zshItem(value, `completion script for ${value}`));
      return `    (${sub}) (( CURRENT - i == 1 )) && items=(${items.join(' ')}) ;;`;
    }
    const items = flagsOf(sub).flatMap((flag) =>
      spellings(flag).map((s) => zshItem(s, flag.description))
    );
    return `    (${sub}) items=(${items.join(' ')}) ;;`;
  });
  const top = [
    ...SUBCOMMANDS.map((sub) => zshItem(sub, SUBCOMMAND_INFO[sub].description)),
    ...flagsOf(null).flatMap((flag) => spellings(flag).map((s) => zshItem(s, flag.description))),
  ];
  return `#compdef ${COMMAND}
${ZSH_FN}() {
  local cur=\${words[CURRENT]} prev=\${words[CURRENT-1]} sub="" i
  local -a items
  for (( i = 2; i < CURRENT; i++ )); do
    case \${words[i]} in
      (${SUBCOMMANDS.join('|')}) sub=\${words[i]}; break ;;
    esac
  done
  case "$sub:$prev" in
${valueCases.join('\n')}
  esac
  case $sub in
${itemCases.join('\n')}
    (*) items=(${top.join(' ')}) ;;
  esac
  _describe -t values '${COMMAND}' items
}
if [ "$funcstack[1]" = "${ZSH_FN}" ]; then
  ${ZSH_FN} "$@"
else
  compdef ${ZSH_FN} ${COMMAND}
fi
`;
}

const fishQuote = (text: string) => `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function fishFlag(flag: FlagInfo, condition: string): string {
  const parts = [
    `complete -c ${COMMAND}`,
    `-n ${fishQuote(condition)}`,
    `-l ${flag.name.slice(2)}`,
  ];
  if (flag.short) parts.push(`-s ${flag.short.slice(1)}`);
  if (flag.values === 'file') parts.push('-r -F');
  else if (flag.values === 'text') parts.push('-x');
  else if (flag.values) parts.push(`-x -a ${fishQuote(flag.values.join(' '))}`);
  parts.push(`-d ${fishQuote(flag.description)}`);
  return parts.join(' ');
}

function fish(): string {
  const subs = SUBCOMMANDS.join(' ');
  const noSub = `not __fish_seen_subcommand_from ${subs}`;
  const lines = [
    `# fish completion for ${COMMAND}`,
    `complete -c ${COMMAND} -f`,
    ...SUBCOMMANDS.map(
      (sub) =>
        `complete -c ${COMMAND} -n ${fishQuote(noSub)} -a ${sub} -d ${fishQuote(SUBCOMMAND_INFO[sub].description)}`
    ),
    ...GLOBAL_FLAGS.map((flag) => fishFlag(flag, 'true')),
    ...WIZARD_FLAGS.map((flag) => fishFlag(flag, noSub)),
    ...SUBCOMMANDS.flatMap((sub) => {
      const info = SUBCOMMAND_INFO[sub];
      const seen = `__fish_seen_subcommand_from ${sub}`;
      if (info.argument) {
        return [
          `complete -c ${COMMAND} -n ${fishQuote(`${seen}; and not __fish_seen_subcommand_from ${info.argument.join(' ')}`)} -a ${fishQuote(info.argument.join(' '))}`,
        ];
      }
      return info.flags.map((flag) => fishFlag(flag, seen));
    }),
  ];
  return `${lines.join('\n')}\n`;
}

/** The completion script for a shell, generated from the CLI's own description. */
export function completionScript(shell: CompletionShell): string {
  switch (shell) {
    case 'bash':
      return bash();
    case 'zsh':
      return zsh();
    case 'fish':
      return fish();
  }
}
