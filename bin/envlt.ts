#!/usr/bin/env node
import { Command } from 'commander';

const program = new Command();
program.name('envlt').description('Encrypted environment variable manager').version('0.1.0');

program.parse();
