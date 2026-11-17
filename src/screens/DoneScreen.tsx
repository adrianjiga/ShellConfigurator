import { Box, Text, useApp, useInput } from 'ink';
import { useRef, useState } from 'react';
import { ConfigPlan, TaskPlan } from '../components/PlanSections.tsx';
import { WizardLayout } from '../components/WizardLayout.tsx';
import { uiColor } from '../config/colors.ts';
import { getShell, setupCommand } from '../config/shells.ts';
import { type ReportedStatus, statusMark } from '../config/status.ts';
import { getShellConfigPath } from '../generators/shellRc.ts';
import { errorMessage } from '../services/errors.ts';
import { fontLabel, getFontFamily, MANUAL_STARSHIP_INSTALL } from '../services/installer.ts';
import {
  buildTaskList,
  fontsElsewhere,
  plannedResetShells,
  rcTaskId,
  sharedConfigNote,
  TASK_IDS,
} from '../services/installTasks.ts';
import { writeShareFile } from '../services/share.ts';
import {
  fontIdToInstall,
  type InstallTask,
  type InstallTaskId,
  type ShellId,
  type WizardState,
} from '../types.ts';

interface DoneScreenProps {
  state: WizardState;
}

/** One scan per task; callers read .status/.error/.note from the same result. */
function findTask(state: WizardState, id: InstallTaskId): InstallTask | undefined {
  return state.installResults.find((t) => t.id === id);
}

function StatusMark({ status }: { status: ReportedStatus }) {
  const { icon, color } = statusMark(status);
  return <Text color={uiColor(color)}>{icon}</Text>;
}

/** A task's outcome as one row, with its error or note beneath it. */
function TaskRow({ task }: { task: InstallTask }) {
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <StatusMark status={task.status} />
        <Text>{task.label}</Text>
      </Box>
      {(task.error || task.note) && (
        <Box marginLeft={3}>
          <Text color={uiColor(task.error ? 'red' : 'gray')} italic>
            {task.error ?? task.note}
          </Text>
        </Box>
      )}
    </Box>
  );
}

export function DoneScreen({ state }: DoneScreenProps) {
  const { exit } = useApp();
  const fontId = fontIdToInstall(state.nerdFontToInstall);
  const fontName = fontId ? fontLabel(fontId) : null;
  const [shared, setShared] = useState<{ file: string } | { error: string } | null>(null);
  const canShare = !state.keepExistingConfig;
  const resetNote = sharedConfigNote(
    state.installResults
      .filter((task) => task.id.startsWith('reset_') && task.status === 'done')
      .map((task) => task.id.slice('reset_'.length) as ShellId),
    true
  );
  const saved = useRef(false);
  const [pending, setPending] = useState(false);

  const failures = state.installResults.filter((t) => t.status === 'failed');
  const hasFailures = failures.length > 0;
  // A dry run never installs, so it has no results to report by design.
  const noResults = !state.dryRun && state.installResults.length === 0;

  function share(): void {
    if (saved.current) return;
    try {
      const file = writeShareFile(state);
      saved.current = true;
      setShared({ file });
    } catch (err) {
      setShared({ error: errorMessage(err) });
    }
  }

  useInput((char, key) => {
    if (pending) {
      setPending(false);
      if (char.toLowerCase() === 'y') share();
      return;
    }
    if (key.return || key.escape || char.toLowerCase() === 'q') {
      exit();
      return;
    }
    if (char.toLowerCase() === 's' && canShare && !saved.current) {
      setPending(true);
    }
  });

  const starshipTask = findTask(state, TASK_IDS.starship);
  const verifyTask = findTask(state, TASK_IDS.verify);
  const configTask = findTask(state, TASK_IDS.config);
  const fontTask = findTask(state, TASK_IDS.font);
  const terminalTask = findTask(state, TASK_IDS.terminal);
  const chshTask = findTask(state, TASK_IDS.chsh);
  const chshOk = chshTask?.status === 'done';

  const heading = state.dryRun
    ? 'Dry run — no changes were made'
    : noResults
      ? 'Finished — no results recorded'
      : hasFailures
        ? 'Finished with errors'
        : 'All done!';

  return (
    <WizardLayout state={state} hidePreview>
      <Box flexDirection="column" gap={1}>
        <Text bold color={uiColor(hasFailures || noResults ? 'yellow' : 'green')}>
          {heading}
        </Text>

        {noResults && (
          <Text color={uiColor('yellow')}>
            The install step reported nothing back, so none of the steps below are confirmed. Re-run
            the wizard to verify.
          </Text>
        )}

        {state.dryRun && (
          <>
            <Text color={uiColor('yellow')} italic>
              A real run would carry out the tasks below and write the config below.
            </Text>

            <TaskPlan
              title="Tasks that would run"
              tasks={buildTaskList(state, plannedResetShells(state))}
            />
            <ConfigPlan state={state} />
          </>
        )}

        {!state.dryRun && resetNote && <Text color={uiColor('yellow')}>{resetNote}</Text>}

        {!state.dryRun && (
          <Box flexDirection="column" marginTop={1} gap={1}>
            {starshipTask && <TaskRow task={starshipTask} />}
            <Box flexDirection="column">
              <Box flexDirection="row" gap={1}>
                <StatusMark status={configTask?.status ?? 'unknown'} />
                <Text>
                  {configTask?.status === 'done'
                    ? 'Per-shell config written'
                    : 'Config not written'}
                </Text>
              </Box>
              {configTask?.status === 'done' &&
                state.selectedShells.map((shellId) => (
                  <Box key={shellId} marginLeft={3} flexDirection="row" gap={1}>
                    <Text color={uiColor('cyan')}>{getShellConfigPath(shellId)}</Text>
                    <Text color={uiColor('gray')}>(for {shellId})</Text>
                  </Box>
                ))}
              {configTask?.status === 'failed' && (
                <Box marginLeft={3}>
                  <Text color={uiColor('red')} italic>
                    {configTask.error}
                  </Text>
                </Box>
              )}
              {configTask?.note && (
                <Box marginLeft={3}>
                  <Text color={uiColor('gray')} italic>
                    {configTask.note}
                  </Text>
                </Box>
              )}
            </Box>

            {fontId && fontsElsewhere(state) && (
              <Box flexDirection="row" gap={1}>
                <StatusMark status="skipped" />
                <Text>Nerd Font skipped — {fontsElsewhere(state)}</Text>
              </Box>
            )}
            {fontId && !fontsElsewhere(state) && (
              <Box flexDirection="column">
                <Box flexDirection="row" gap={1}>
                  <StatusMark status={fontTask?.status ?? 'unknown'} />
                  <Text>
                    Nerd Font {fontTask?.status === 'done' ? 'installed' : 'not installed'}:{' '}
                    <Text color={uiColor('cyan')}>{fontName}</Text>
                  </Text>
                </Box>
                {fontTask?.status === 'failed' && (
                  <Box marginLeft={3}>
                    <Text color={uiColor('red')} italic>
                      {fontTask.error}
                    </Text>
                  </Box>
                )}
              </Box>
            )}

            {state.selectedShells.map((shellId) => {
              const shell = getShell(shellId);
              const wasInstalled = state.installedShells.includes(shellId);
              const installTask = findTask(state, `shell_${shellId}`);
              const installOk = wasInstalled || installTask?.status === 'done';
              // Each shell has its own rc task, so one shell failing no longer
              // marks the others as failed.
              const rcTask = findTask(state, rcTaskId(shellId));
              const rcNote = rcTask?.note;
              return (
                <Box key={shellId} flexDirection="column">
                  <Box flexDirection="row" gap={1}>
                    <StatusMark status={rcTask?.status ?? 'unknown'} />
                    <Text>
                      {shell?.label ?? shellId.charAt(0).toUpperCase() + shellId.slice(1)}:
                    </Text>
                    {!wasInstalled && (
                      <Text color={uiColor(installOk ? 'cyan' : 'red')}>
                        {installOk ? 'installed + ' : 'install failed'}
                      </Text>
                    )}
                    <Text color={uiColor('gray')}>
                      {rcTask?.status === 'done'
                        ? `${shell?.rcFile} updated`
                        : rcTask?.status === 'skipped'
                          ? shell?.rcFile
                            ? (rcNote ?? 'skipped')
                            : rcNote === 'already configured'
                              ? 'already configured'
                              : 'set up manually'
                          : rcTask?.status === 'failed'
                            ? 'not configured'
                            : 'status unknown'}
                    </Text>
                  </Box>
                  {installTask?.status === 'failed' && !wasInstalled && (
                    <Box marginLeft={3}>
                      <Text color={uiColor('red')} italic>
                        {installTask.error}
                      </Text>
                    </Box>
                  )}
                  {rcTask?.status === 'failed' && (
                    <Box marginLeft={3}>
                      <Text color={uiColor('red')} italic>
                        {rcTask.error}
                      </Text>
                    </Box>
                  )}
                  {/* Manual-only shells (nushell, powershell) show the init command, unless it was already applied. */}
                  {rcTask?.status === 'skipped' &&
                    !shell?.rcFile &&
                    shell?.initLine &&
                    rcNote !== 'already configured' && (
                      <Box marginLeft={3}>
                        <Text color={uiColor('cyan')}>
                          {setupCommand(shell, state.keepExistingConfig)}
                        </Text>
                      </Box>
                    )}
                  {(rcTask?.status === 'done' ||
                    (rcTask?.status === 'skipped' && !shell?.rcFile)) &&
                    rcNote && (
                      <Box marginLeft={3}>
                        <Text color={uiColor('gray')} italic>
                          {rcNote}
                        </Text>
                      </Box>
                    )}
                </Box>
              );
            })}

            {terminalTask && <TaskRow task={terminalTask} />}
            {verifyTask && <TaskRow task={verifyTask} />}
            {state.setDefaultShell && state.container && (
              <Box flexDirection="row" gap={1}>
                <StatusMark status="skipped" />
                <Text>Default shell left to the container image</Text>
              </Box>
            )}
            {state.setDefaultShell && !state.container && (
              <Box flexDirection="column">
                <Box flexDirection="row" gap={1}>
                  <StatusMark status={chshTask?.status ?? 'unknown'} />
                  <Text>
                    Default shell {chshOk ? 'set to' : 'not set to'}{' '}
                    <Text color={uiColor('cyan')}>{state.setDefaultShell}</Text>
                  </Text>
                </Box>
                {chshTask?.error && (
                  <Box marginLeft={3}>
                    <Text color={uiColor('red')} italic>
                      {chshTask.error}
                    </Text>
                  </Box>
                )}
              </Box>
            )}
          </Box>
        )}

        <Box marginTop={1} flexDirection="column">
          {state.dryRun ? (
            <Text color={uiColor('gray')}>
              Run without <Text color={uiColor('cyan')}>--dry-run</Text> to apply these changes.
            </Text>
          ) : (
            <>
              {configTask?.status === 'done' && (
                <Text color={uiColor('gray')}>Restart your terminal to see the new prompt.</Text>
              )}
              {state.skipStarshipInstall && (
                <Text color={uiColor('yellow')}>
                  Starship is not installed, so shell init lines were not added. Install it (e.g.{' '}
                  <Text color={uiColor('cyan')}>{MANUAL_STARSHIP_INSTALL}</Text>
                  ), then re-run the wizard to configure your shells.
                </Text>
              )}
              {fontId && fontTask?.status === 'done' && terminalTask?.status !== 'done' && (
                <Text color={uiColor('yellow')}>
                  Remember to set{' '}
                  <Text color={uiColor('cyan')}>
                    {(fontId && getFontFamily(fontId)) ?? fontName}
                  </Text>{' '}
                  in your terminal emulator settings.
                </Text>
              )}
              <Text color={uiColor('gray')}>
                After restarting, run <Text color={uiColor('cyan')}>starship print-config</Text> to
                view the config the shell loads.
              </Text>
              <Text color={uiColor('gray')}>
                Run <Text color={uiColor('cyan')}>shell-configurator doctor</Text> to check the
                setup.
              </Text>
              {state.summaryPath && (
                <Text color={uiColor('gray')}>
                  What changed, and how to undo it:{' '}
                  <Text color={uiColor('cyan')}>{state.summaryPath}</Text>
                </Text>
              )}
            </>
          )}
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text color={uiColor('gray')}>Press </Text>
        <Text color={uiColor('cyan')}>q</Text>
        <Text color={uiColor('gray')}>, </Text>
        <Text color={uiColor('cyan')}>Enter</Text>
        <Text color={uiColor('gray')}> or </Text>
        <Text color={uiColor('cyan')}>Esc</Text>
        <Text color={uiColor('gray')}> to exit.</Text>
      </Box>

      {state.runId && (
        <Box marginTop={1}>
          <Text color={uiColor('gray')}>
            To undo this run, rc lines included, run{' '}
            <Text color={uiColor('cyan')}>shell-configurator rollback</Text>.
          </Text>
        </Box>
      )}

      {canShare && (
        <Box marginTop={1}>
          <Text color={uiColor('gray')}>
            {shared === null ? (
              <>
                Press <Text color={uiColor('cyan')}>s</Text> to save this prompt as Markdown to
                share, with the card that rebuilds it. This writes starship-prompt.md in this folder
                {state.dryRun ? ', even in a dry run' : ''}.
              </>
            ) : 'file' in shared ? (
              <>
                Saved the prompt to share: <Text color={uiColor('cyan')}>{shared.file}</Text>
              </>
            ) : (
              <>
                <Text color={uiColor('red')}>Could not save the prompt: {shared.error}</Text> Press{' '}
                <Text color={uiColor('cyan')}>s</Text> to try again.
              </>
            )}
          </Text>
        </Box>
      )}

      {pending && (
        <Box marginTop={1}>
          <Text color={uiColor('yellow')}>
            Save starship-prompt.md in this folder? Press <Text color={uiColor('cyan')}>y</Text> to
            go ahead, any other key to cancel.
          </Text>
        </Box>
      )}
    </WizardLayout>
  );
}
