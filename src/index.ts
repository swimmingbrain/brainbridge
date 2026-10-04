#!/usr/bin/env node
import { main } from './cli.js';

await main(process.argv.slice(2));
