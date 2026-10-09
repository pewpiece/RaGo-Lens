import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { Banner, Button, Header, Muted, Screen } from '@/components/ui';
import { runSelfTest } from '@/diagnostics/selfTest';
import { useTheme } from '@/theme/ThemeProvider';
import { fonts, fontSizes, spacing } from '@/theme/tokens';

export default function SelfTest() {
  const { tokens: t } = useTheme();
  const [lines, setLines] = useState<string[]>([]);
  const [state, setState] = useState<'running' | 'pass' | 'fail'>('running');

  const [runId, setRunId] = useState(0);

  useEffect(() => {
    let alive = true;
    void runSelfTest((l) => alive && setLines((p) => [...p, l])).then((r) => {
      if (alive) setState(r.passed ? 'pass' : 'fail');
    });
    return () => {
      alive = false;
    };
  }, [runId]);

  const rerun = () => {
    setLines([]);
    setState('running');
    setRunId((n) => n + 1);
  };

  return (
    <Screen scroll header={<Header title="Diagnostics" />}>
      <Muted>
        Runs the real model on a built-in sample photo and checks that the transparent export works
        on this phone.
      </Muted>
      <Banner tone={state === 'fail' ? 'error' : 'info'}>
        {state === 'running'
          ? 'Running…'
          : state === 'pass'
            ? 'PASS: everything works on this phone.'
            : 'FAIL: see the details below and send them to the developer.'}
      </Banner>
      <Text
        selectable
        style={{
          color: t.text,
          fontFamily: fonts.mono,
          fontSize: fontSizes.caption,
          marginVertical: spacing.lg,
        }}
      >
        {lines.join('\n')}
      </Text>
      <Button label="Run again" onPress={rerun} disabled={state === 'running'} />
    </Screen>
  );
}
