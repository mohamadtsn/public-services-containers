import { Box, Text, render, useApp, useInput } from 'ink';
import { useCallback, useEffect, useState } from 'react';
import type { Ctx } from './context.js';
import { type ContainerStatus, compose, inspectMany } from './docker.js';
import { type ServiceInfo, services } from './env.js';
import { packageVersion } from './home.js';
import { profilesForUp } from './profiles.js';
import { tildify } from './ui.js';

const REFRESH_MS = 2000;

export const TONE: Record<ContainerStatus, string> = {
  healthy: 'green',
  running: 'green',
  starting: 'yellow',
  unhealthy: 'red',
  stopped: 'yellow',
  missing: 'gray',
};

export const DOT: Record<ContainerStatus, string> = {
  healthy: '●',
  running: '●',
  starting: '●',
  unhealthy: '●',
  stopped: '○',
  missing: '○',
};

type Pending = { key: string; label: string; run: () => Promise<void> } | null;

interface RowProps {
  service: ServiceInfo;
  status: ContainerStatus | null;
  selected: boolean;
  labelWidth: number;
  statusWidth: number;
}

function Row({ service, status, selected, labelWidth, statusWidth }: RowProps) {
  // `null` means the first inspect has not returned yet. Rendering "not found"
  // in that gap would falsely report a healthy stack as down.
  const cell = status === null ? '  … checking' : `  ${DOT[status]} ${status}`;
  return (
    <Text wrap="truncate">
      <Text color={selected ? 'cyan' : undefined}>{selected ? '❯ ' : '  '}</Text>
      <Text bold={selected}>{service.label.padEnd(labelWidth)}</Text>
      <Text color={status === null ? 'gray' : TONE[status]}>{cell.padEnd(statusWidth + 4)}</Text>
      <Text dimColor>{service.address}</Text>
    </Text>
  );
}

function Dashboard({ ctx }: { ctx: Ctx }) {
  const { exit } = useApp();
  const list = services(ctx.env);

  const [states, setStates] = useState<Map<string, ContainerStatus> | null>(null);
  const [cursor, setCursor] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStates(await inspectMany(list.map((s) => s.container)));
    } catch {
      // A transient docker hiccup should not tear the dashboard down; the next
      // tick will pick the state back up.
    }
  }, [list]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const act = useCallback(
    async (label: string, args: string[], profiles: string[] = []) => {
      setBusy(label);
      setError(null);
      const res = await compose(ctx.home, args, { profiles });
      if (res.code !== 0) {
        setError((res.stderr || res.stdout).trim().split('\n').slice(-1)[0] ?? 'command failed');
      }
      setBusy(null);
      await refresh();
    },
    [ctx.home, refresh],
  );

  useInput((input, key) => {
    if (busy) return;

    if (pending) {
      if (input === 'y' || input === 'Y') {
        const job = pending;
        setPending(null);
        void job.run();
      } else {
        setPending(null);
      }
      return;
    }

    const current = list[cursor];

    if (key.upArrow || input === 'k') setCursor((c) => (c - 1 + list.length) % list.length);
    else if (key.downArrow || input === 'j') setCursor((c) => (c + 1) % list.length);
    else if (input === 'q' || key.escape) exit();
    else if (input === 'R') void refresh();
    else if (input === 'a') void act('starting core', ['up', '-d']);
    else if (input === 'f') void act('starting everything', ['up', '-d'], profilesForUp({ full: true }));
    else if (current && input === 's') void act(`starting ${current.key}`, ['up', '-d', current.key]);
    else if (current && input === 'r') void act(`restarting ${current.key}`, ['restart', current.key]);
    else if (current && input === 'x') {
      // Stopping is the one destructive key here, so it asks first.
      setPending({
        key: current.key,
        label: `Stop ${current.label}?`,
        run: () => act(`stopping ${current.key}`, ['stop', current.key]),
      });
    }
  });

  const labelWidth = Math.max(...list.map((s) => s.label.length));
  const statusWidth = Math.max(...Object.keys(TONE).map((s) => s.length));

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box>
        <Text color="cyan" bold wrap="truncate">
          Public Services
        </Text>
        {/* truncate-start keeps the tail of a long path, which is the useful half */}
        <Text dimColor wrap="truncate-start">{`  v${packageVersion()}  ${tildify(ctx.home)}`}</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {list.map((service, index) => (
          <Row
            key={service.key}
            service={service}
            status={states ? (states.get(service.container) ?? 'missing') : null}
            selected={index === cursor}
            labelWidth={labelWidth}
            statusWidth={statusWidth}
          />
        ))}
      </Box>

      <Box marginTop={1} flexDirection="column">
        {busy ? (
          <Text color="yellow">{`  … ${busy}`}</Text>
        ) : pending ? (
          <Text color="yellow">{`  ${pending.label} [y/N]`}</Text>
        ) : error ? (
          <Text color="red">{`  ✗ ${error}`}</Text>
        ) : (
          <Text dimColor wrap="truncate">
            {'  ↑↓ select   s start   x stop   r restart   a core   f all   R refresh   q quit'}
          </Text>
        )}
      </Box>
    </Box>
  );
}

export async function runDash(ctx: Ctx): Promise<void> {
  const app = render(<Dashboard ctx={ctx} />);
  await app.waitUntilExit();
}
