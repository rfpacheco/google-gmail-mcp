/**
 * Configuration Loader Utility.
 *
 * Provides functions to safely load local user configurations with fallback
 * to version-controlled example templates, ensuring sensitive rules and whitelists
 * are not tracked in git.
 *
 * @packageDocumentation
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../');

/**
 * Structure of the automated filter rule configuration.
 */
export interface AutomatedRuleConfig {
  /**
   * Descriptive name for the rule.
   */
  name: string;

  /**
   * Gmail query filter criteria.
   */
  criteria: {
    from?: string;
    to?: string;
    subject?: string;
    query?: string;
  };

  /**
   * Name of the target label in the hierarchy.
   */
  targetLabelName: string;

  /**
   * Array of label IDs to remove (e.g. `['INBOX']`).
   */
  removeLabelIds?: string[];
}

/**
 * Sender triage mapping definition.
 */
export interface SenderTriageMapping {
  /**
   * Substring to match against sender address or header.
   */
  match: string;

  /**
   * Target taxonomy label name.
   */
  targetLabel: string;

  /**
   * Optional additional labels to apply.
   */
  additionalLabels?: string[];
}

/**
 * Structure of the rules configuration file.
 */
export interface RulesConfig {
  /**
   * Label renaming map (e.g. `DEV` -> `Dev`).
   */
  labelRenameMap: Record<string, string>;

  /**
   * Automated persistent filter rules.
   */
  automatedRules: AutomatedRuleConfig[];

  /**
   * Sender substring mappings for quick triage.
   */
  senderTriageMappings?: SenderTriageMapping[];
}

/**
 * Structure of the purge configuration file.
 */
export interface PurgeConfig {
  /**
   * Whitelist substrings to protect from deletion.
   */
  protectionPatterns: string[];

  /**
   * Gmail query to search for purge candidates (e.g. `older_than:5y`).
   */
  candidateQuery?: string;

  /**
   * Explicit message IDs to evaluate for purging.
   */
  candidateIds?: string[];
}

/**
 * Loads rules configuration from `config/rules.local.json` if available,
 * otherwise falls back to `config/rules.example.json`.
 *
 * @returns Parsed RulesConfig object.
 */
export function loadRulesConfig(): RulesConfig {
  const localPath = path.join(PROJECT_ROOT, 'config/rules.local.json');
  const examplePath = path.join(PROJECT_ROOT, 'config/rules.example.json');

  if (fs.existsSync(localPath)) {
    const raw = fs.readFileSync(localPath, 'utf-8');
    return JSON.parse(raw) as RulesConfig;
  }

  if (fs.existsSync(examplePath)) {
    const raw = fs.readFileSync(examplePath, 'utf-8');
    return JSON.parse(raw) as RulesConfig;
  }

  return {
    labelRenameMap: {},
    automatedRules: [],
    senderTriageMappings: [],
  };
}

/**
 * Loads purge configuration from `config/purge.local.json` if available,
 * otherwise falls back to `config/purge.example.json`.
 *
 * @returns Parsed PurgeConfig object.
 */
export function loadPurgeConfig(): PurgeConfig {
  const localPath = path.join(PROJECT_ROOT, 'config/purge.local.json');
  const examplePath = path.join(PROJECT_ROOT, 'config/purge.example.json');

  if (fs.existsSync(localPath)) {
    const raw = fs.readFileSync(localPath, 'utf-8');
    return JSON.parse(raw) as PurgeConfig;
  }

  if (fs.existsSync(examplePath)) {
    const raw = fs.readFileSync(examplePath, 'utf-8');
    return JSON.parse(raw) as PurgeConfig;
  }

  return {
    protectionPatterns: [],
    candidateQuery: 'older_than:5y',
    candidateIds: [],
  };
}
