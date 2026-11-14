#!/usr/bin/env node
import { assertGenerate, requireScratchHome, runSmoke } from './smokeHome.mjs';

// Headless-generate CI leg: drive the real `generate` subcommand from dist/ and
// assert the two publish paths — TOML to stdout, and the -o/--export artifacts.
const homeDir = requireScratchHome();

await runSmoke('Headless generate smoke', () => assertGenerate(homeDir, 'bash'));
