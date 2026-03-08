# AgentBlackBox — Spécification Technique Complète

## 🎯 Vision du Projet

**AgentBlackBox** est un outil open-source d'observabilité et de sécurité pour agents IA (Claude Code, Cursor, OpenAI Codex, AutoGPT, CrewAI, etc.). C'est la "boîte noire" des agents IA : il enregistre chaque action qu'un agent effectue sur ta machine, permet le replay visuel de sessions complètes, et intègre **DriftDetect** — un système intelligent qui détecte en temps réel quand un agent diverge de l'objectif original de l'utilisateur.

**Analogie** : Sentry est aux erreurs web ce qu'AgentBlackBox est aux agents IA. Datadog monitore tes serveurs, AgentBlackBox monitore tes agents.

---

## 📐 Architecture Globale

```
agentblackbox/
├── packages/
│   ├── core/                   # SDK léger d'instrumentation (Node.js)
│   │   ├── src/
│   │   │   ├── recorder.ts     # Moteur d'enregistrement principal
│   │   │   ├── interceptors/   # Intercepteurs par type d'action
│   │   │   │   ├── terminal.ts # Hook sur les commandes shell
│   │   │   │   ├── filesystem.ts # Surveillance des fichiers (chokidar)
│   │   │   │   ├── network.ts  # Interception des appels API/HTTP
│   │   │   │   └── llm.ts     # Interception spécifique des appels LLM
│   │   │   ├── storage/        # Persistance des traces
│   │   │   │   ├── sqlite.ts   # Stockage local SQLite
│   │   │   │   └── schema.ts   # Schéma de la base de données
│   │   │   ├── drift/          # Moteur DriftDetect
│   │   │   │   ├── engine.ts   # Logique principale de détection
│   │   │   │   ├── scorer.ts   # Algorithme de scoring de cohérence
│   │   │   │   └── alerts.ts   # Système d'alertes
│   │   │   ├── guardrails/     # Moteur de garde-fous
│   │   │   │   ├── rules.ts    # Définition des règles
│   │   │   │   └── enforcer.ts # Application des règles
│   │   │   ├── types.ts        # Types TypeScript partagés
│   │   │   └── index.ts        # Export principal du SDK
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── cli/                    # Interface en ligne de commande
│   │   ├── src/
│   │   │   ├── commands/
│   │   │   │   ├── init.ts     # agentblackbox init
│   │   │   │   ├── record.ts   # agentblackbox record <command>
│   │   │   │   ├── replay.ts   # agentblackbox replay <session-id>
│   │   │   │   ├── sessions.ts # agentblackbox sessions (lister)
│   │   │   │   ├── stats.ts    # agentblackbox stats
│   │   │   │   └── serve.ts    # agentblackbox serve (lance le dashboard)
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   └── dashboard/              # Interface web (React)
│       ├── src/
│       │   ├── components/
│       │   │   ├── SessionList.tsx      # Liste des sessions enregistrées
│       │   │   ├── SessionTimeline.tsx  # Timeline visuelle d'une session
│       │   │   ├── ActionDetail.tsx     # Détail d'une action spécifique
│       │   │   ├── DiffViewer.tsx       # Comparaison avant/après fichiers
│       │   │   ├── DriftScore.tsx       # Visualisation du score DriftDetect
│       │   │   ├── DriftAlert.tsx       # Composant d'alerte de divergence
│       │   │   ├── CostTracker.tsx      # Suivi des coûts par session
│       │   │   ├── GuardrailsConfig.tsx # Configuration des garde-fous
│       │   │   ├── LiveTrace.tsx        # Vue temps réel des actions
│       │   │   └── Layout.tsx           # Layout principal du dashboard
│       │   ├── hooks/
│       │   │   ├── useSession.ts
│       │   │   ├── useDrift.ts
│       │   │   └── useWebSocket.ts
│       │   ├── App.tsx
│       │   └── main.tsx
│       ├── package.json
│       └── vite.config.ts
│
├── .agentblackbox/             # Dossier local (créé par `init`)
│   ├── config.yaml             # Configuration utilisateur
│   └── traces.db               # Base SQLite locale
│
├── CLAUDE.md                   # Instructions pour Claude Code
├── README.md
├── package.json                # Monorepo (pnpm workspaces)
├── pnpm-workspace.yaml
└── turbo.json                  # Turborepo config
```

---

## 🔧 Stack Technique

| Composant | Technologie | Pourquoi |
|-----------|-------------|----------|
| **Langage** | TypeScript | Écosystème IA Node.js dominant, types pour la robustesse |
| **Monorepo** | pnpm + Turborepo | Standard industrie, builds rapides |
| **Core SDK** | Node.js pur | Léger, zero dépendances lourdes |
| **Surveillance fichiers** | chokidar | Le standard pour le file watching Node.js |
| **Base de données** | better-sqlite3 | Zéro config, performant, local-first |
| **CLI** | Commander.js + Ink | CLI riche avec rendu React dans le terminal |
| **Dashboard** | React + Vite + Tailwind CSS | Rapide à dev, rendu moderne |
| **Visualisation** | D3.js + Recharts | Timelines, graphes, visualisations custom |
| **Diff** | diff2html | Rendu visuel des diffs de fichiers |
| **Communication** | WebSocket (ws) | Streaming temps réel dashboard ↔ core |
| **DriftDetect** | Appel LLM local (Ollama) ou API | Scoring de cohérence via un modèle |

---

## 📦 Module 1 : Core SDK (`packages/core`)

### 1.1 — Le Recorder (`recorder.ts`)

Le coeur du système. Il orchestre tous les intercepteurs et écrit les traces.

```typescript
// Types principaux
interface AgentSession {
  id: string;                    // UUID unique
  objective: string;             // L'objectif déclaré par l'utilisateur
  startedAt: Date;
  endedAt?: Date;
  status: 'recording' | 'completed' | 'aborted';
  metadata: {
    agent: string;               // "claude-code", "cursor", "autogpt", etc.
    model?: string;              // "claude-sonnet-4-20250514", "gpt-4", etc.
    workingDir: string;
    gitBranch?: string;
    gitCommitBefore?: string;    // Snapshot git avant la session
  };
}

interface TraceEvent {
  id: string;
  sessionId: string;
  timestamp: Date;
  sequence: number;              // Ordre séquentiel dans la session
  type: 'command' | 'file_read' | 'file_write' | 'file_delete' |
        'api_call' | 'llm_call' | 'decision' | 'error' | 'guardrail_trigger';
  data: CommandEvent | FileEvent | ApiEvent | LlmEvent | DecisionEvent;
  driftScore?: number;           // Score de cohérence (0-100) si DriftDetect actif
  driftFlag?: 'ok' | 'warning' | 'critical';
  costUsd?: number;              // Coût estimé de cette action
  durationMs: number;
}

interface CommandEvent {
  command: string;               // La commande exécutée
  args: string[];
  cwd: string;
  exitCode?: number;
  stdout?: string;               // Tronqué à 10KB
  stderr?: string;
}

interface FileEvent {
  path: string;
  action: 'read' | 'write' | 'delete' | 'rename';
  contentBefore?: string;        // Hash ou contenu tronqué
  contentAfter?: string;
  diff?: string;                 // Diff unifié si applicable
  sizeBytes: number;
}

interface LlmEvent {
  provider: string;              // "anthropic", "openai", "ollama"
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;               // Calculé via une table de prix
  latencyMs: number;
  prompt?: string;               // Tronqué, optionnel
  response?: string;             // Tronqué, optionnel
  toolCalls?: string[];          // Noms des outils appelés
}

interface DecisionEvent {
  description: string;           // Ce que l'agent a "décidé" de faire
  reasoning?: string;            // Le raisonnement si disponible
  alternatives?: string[];       // Alternatives considérées
}
```

### 1.2 — Intercepteurs (`interceptors/`)

**Terminal Interceptor** (`terminal.ts`):
- Wrappe `child_process.spawn` et `child_process.exec`
- Capture : commande, arguments, répertoire courant, code de sortie, stdout/stderr (tronqué)
- Filtre les commandes sensibles (masque les tokens/clés API dans les arguments)

**Filesystem Interceptor** (`filesystem.ts`):
- Utilise `chokidar` pour surveiller le répertoire de travail
- Capture : chemin, type d'action (create/modify/delete), diff avant/après
- Ignore les patterns configurables (.git, node_modules, .agentblackbox, etc.)
- Génère un diff unifié pour chaque modification de fichier

**Network Interceptor** (`network.ts`):
- Hook sur `http.request` et `https.request` via monkey-patching
- Capture : URL, méthode, headers (sans auth), status code, taille de la réponse, latence
- NE capture PAS le body complet (privacy) — seulement les métadonnées

**LLM Interceptor** (`llm.ts`):
- Détection automatique des appels vers les APIs connues (api.anthropic.com, api.openai.com, localhost:11434 pour Ollama)
- Extraction des tokens (prompt/completion), du modèle utilisé, du coût
- Table de prix intégrée et mise à jour pour calculer les coûts en USD
- Capture optionnelle du contenu des prompts/réponses (désactivable pour privacy)

### 1.3 — Stockage SQLite (`storage/`)

```sql
-- Schema principal
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  objective TEXT NOT NULL,
  agent TEXT,
  model TEXT,
  working_dir TEXT NOT NULL,
  git_branch TEXT,
  git_commit_before TEXT,
  git_commit_after TEXT,
  started_at DATETIME NOT NULL,
  ended_at DATETIME,
  status TEXT DEFAULT 'recording',
  total_cost_usd REAL DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  total_actions INTEGER DEFAULT 0,
  final_drift_score REAL,
  metadata TEXT -- JSON blob pour les extras
);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  sequence INTEGER NOT NULL,
  timestamp DATETIME NOT NULL,
  type TEXT NOT NULL,
  data TEXT NOT NULL,          -- JSON sérialisé de l'event
  drift_score REAL,
  drift_flag TEXT,
  cost_usd REAL DEFAULT 0,
  duration_ms INTEGER DEFAULT 0,
  UNIQUE(session_id, sequence)
);

CREATE TABLE drift_snapshots (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  event_id TEXT NOT NULL REFERENCES events(id),
  score REAL NOT NULL,         -- 0 (totalement hors sujet) à 100 (parfaitement aligné)
  flag TEXT NOT NULL,           -- 'ok', 'warning', 'critical'
  reason TEXT,                  -- Explication humaine de la divergence
  created_at DATETIME NOT NULL
);

CREATE TABLE guardrail_violations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  event_id TEXT REFERENCES events(id),
  rule_name TEXT NOT NULL,
  severity TEXT NOT NULL,       -- 'warn', 'block'
  description TEXT,
  action_taken TEXT,            -- 'logged', 'blocked', 'session_aborted'
  created_at DATETIME NOT NULL
);

-- Index pour les requêtes fréquentes
CREATE INDEX idx_events_session ON events(session_id, sequence);
CREATE INDEX idx_events_type ON events(type);
CREATE INDEX idx_drift_session ON drift_snapshots(session_id);
```

---

## 🧠 Module 2 : DriftDetect (`core/drift/`)

### 2.1 — Concept

DriftDetect compare en continu les actions de l'agent avec l'objectif original déclaré par l'utilisateur. Il utilise un LLM (local via Ollama ou via API) pour "comprendre" si les actions récentes sont cohérentes avec l'objectif.

### 2.2 — Fonctionnement

```
[Objectif utilisateur] + [N dernières actions] → [Prompt DriftDetect] → [LLM] → [Score 0-100 + Explication]
```

**Prompt type pour DriftDetect** :

```
Tu es un système de détection de divergence pour agents IA.

OBJECTIF ORIGINAL DE L'UTILISATEUR :
"{objective}"

DERNIÈRES ACTIONS DE L'AGENT (les plus récentes en dernier) :
{actions_formatted}

Évalue si les actions récentes de l'agent sont cohérentes avec l'objectif original.

Réponds UNIQUEMENT en JSON :
{
  "score": <number 0-100>,      // 100 = parfaitement aligné, 0 = totalement hors sujet
  "flag": "ok" | "warning" | "critical",
  "reason": "<explication courte en 1-2 phrases>",
  "suggestion": "<action corrective suggérée, si applicable>"
}

Critères :
- "ok" (score 70-100) : Les actions sont clairement liées à l'objectif
- "warning" (score 40-69) : Les actions semblent s'éloigner ou sont ambiguës
- "critical" (score 0-39) : Les actions n'ont aucun rapport avec l'objectif ou sont potentiellement dangereuses
```

### 2.3 — Configuration DriftDetect

```yaml
# Dans .agentblackbox/config.yaml
drift:
  enabled: true
  check_every: 5              # Évaluer toutes les N actions
  provider: "ollama"           # "ollama", "anthropic", "openai"
  model: "llama3.2"            # Modèle utilisé pour le scoring
  thresholds:
    warning: 60                # Score en dessous duquel on alerte
    critical: 30               # Score en dessous duquel on bloque (si guardrails actifs)
  context_window: 10           # Nombre d'actions récentes envoyées au LLM
  auto_pause: false            # Mettre en pause l'agent si critical détecté
```

### 2.4 — Scorer (`scorer.ts`)

- Maintient un **score glissant** (moyenne pondérée des N derniers checks)
- Pondération : les actions récentes comptent plus que les anciennes
- **Mode heuristique** (sans LLM) : scoring basé sur des patterns
  - Fichiers modifiés hors du scope du projet → score baisse
  - Commandes `rm -rf`, `sudo`, `curl | bash` → alerte immédiate
  - Trop de temps sans modification de fichier → possible boucle infinie
  - Ratio erreurs/succès qui augmente → agent potentiellement bloqué

---

## ⛔ Module 3 : Guardrails (`core/guardrails/`)

### 3.1 — Règles Configurables

```yaml
# Dans .agentblackbox/config.yaml
guardrails:
  enabled: true
  rules:
    # Fichiers protégés
    - name: "protected_files"
      type: "file_protect"
      paths:
        - ".env"
        - ".env.*"
        - "*.pem"
        - "*.key"
        - "docker-compose.prod.yml"
      action: "block"           # "warn" ou "block"

    # Commandes interdites
    - name: "dangerous_commands"
      type: "command_block"
      patterns:
        - "rm -rf /"
        - "rm -rf ~"
        - "sudo rm"
        - "DROP TABLE"
        - "curl * | bash"
        - "wget * | sh"
      action: "block"

    # Budget maximum
    - name: "cost_limit"
      type: "cost_limit"
      max_usd_per_session: 5.00
      max_usd_per_hour: 2.00
      action: "block"

    # Token limit
    - name: "token_limit"
      type: "token_limit"
      max_tokens_per_session: 500000
      action: "warn"

    # Scope du projet
    - name: "project_scope"
      type: "directory_scope"
      allowed_dirs:
        - "."                   # Répertoire courant uniquement
      blocked_dirs:
        - "/etc"
        - "/usr"
        - "~/.ssh"
      action: "block"
```

---

## 💻 Module 4 : CLI (`packages/cli`)

### 4.1 — Commandes

```bash
# Initialiser AgentBlackBox dans un projet
agentblackbox init
# → Crée .agentblackbox/ avec config.yaml par défaut
# → Ajoute .agentblackbox/ au .gitignore

# Enregistrer une session (wrappe une commande agent)
agentblackbox record --objective "Refactorer le module auth pour utiliser JWT" -- claude-code
agentblackbox record --objective "Ajouter des tests unitaires" -- cursor .
agentblackbox record -o "Fix le bug #123" -- npx autogpt

# Lister les sessions
agentblackbox sessions
agentblackbox sessions --last 10
agentblackbox sessions --status completed

# Voir les stats d'une session
agentblackbox stats <session-id>
# → Nombre d'actions, coût total, score DriftDetect moyen, fichiers modifiés, durée

# Rejouer une session dans le terminal
agentblackbox replay <session-id>
# → Affiche les actions une par une avec timing, comme un replay de match

# Exporter une session
agentblackbox export <session-id> --format json
agentblackbox export <session-id> --format html   # Rapport standalone

# Lancer le dashboard web
agentblackbox serve
agentblackbox serve --port 4242
# → Lance un serveur local avec le dashboard React
```

### 4.2 — Output Terminal (Ink)

Pendant l'enregistrement, le CLI affiche un overlay minimaliste :

```
┌─ AgentBlackBox Recording ──────────────────────────────┐
│ Session: a8f3c2d1  │  Actions: 47  │  Cost: $0.23     │
│ Drift Score: ████████░░ 82/100  │  Status: ● Recording │
│ Last: [FILE] Modified src/auth/jwt.ts (+42 -18)       │
└────────────────────────────────────────────────────────┘
```

Si DriftDetect détecte une divergence :

```
┌─ ⚠️  DRIFT WARNING ───────────────────────────────────┐
│ Score dropped to 45/100                                │
│ Reason: Agent is modifying database schema files       │
│ which are unrelated to the JWT refactoring objective.  │
│                                                        │
│ [C]ontinue   [P]ause   [A]bort                        │
└────────────────────────────────────────────────────────┘
```

---

## 🖥️ Module 5 : Dashboard Web (`packages/dashboard`)

### 5.1 — Pages et Composants

**Page 1 — Sessions List** (`/`)
- Liste de toutes les sessions avec : date, objectif, agent utilisé, durée, coût, score drift moyen
- Filtres par : statut, agent, plage de dates, score drift
- Barre de recherche sur l'objectif
- Badge de couleur pour le drift score (vert/jaune/rouge)

**Page 2 — Session Detail** (`/session/:id`)
- **Header** : Objectif, agent, modèle, durée, coût total, score drift final
- **Timeline** : Frise chronologique verticale de toutes les actions
  - Chaque action est une carte avec : icône (type), timestamp, description, drift score
  - Les actions avec drift warning/critical sont highlight en jaune/rouge
  - Cliquer sur une action ouvre le détail
- **Drift Graph** : Courbe du score drift au fil du temps (Recharts line chart)
  - Zones colorées : vert (>70), jaune (40-70), rouge (<40)
  - Points cliquables qui scrollent vers l'action correspondante
- **Cost Breakdown** : Camembert des coûts par provider/modèle
- **Files Changed** : Liste des fichiers modifiés avec diff viewer intégré

**Page 3 — Live View** (`/live`)
- Vue temps réel quand une session est en cours
- WebSocket qui stream les nouveaux events
- Score drift en temps réel avec animation
- Boutons Pause / Resume / Abort

**Page 4 — Settings** (`/settings`)
- Éditeur de config YAML
- Configuration DriftDetect (provider, modèle, seuils)
- Configuration Guardrails (règles drag & drop)
- Thème clair/sombre

### 5.2 — Design System

- **Thème** : Dark mode par défaut, inspiré des outils dev (Vercel, Linear, Raycast)
- **Couleurs** :
  - Background : `#09090B` (quasi-noir)
  - Surface : `#16161D`
  - Accent principal : `#FF6B2B` (orange vif)
  - Drift OK : `#2ECC71` (vert)
  - Drift Warning : `#FFB443` (ambre)
  - Drift Critical : `#FF4757` (rouge)
  - Texte : `#E8E8ED` / `#9898A8` / `#5A5A6E`
- **Typo** : JetBrains Mono (code), Space Grotesk (titres), DM Sans (body)
- **Animations** : Transitions fluides, entrées staggered, score drift avec spring animation

---

## 🚀 Roadmap MVP

### Phase 1 — "La Boîte Noire" (Semaines 1-2)
**Objectif** : Enregistrer et rejouer des sessions d'agent.

Tâches :
1. Setup monorepo (pnpm + Turborepo)
2. Implémenter `recorder.ts` avec les intercepteurs terminal + filesystem
3. Implémenter le stockage SQLite
4. Créer les commandes CLI : `init`, `record`, `sessions`, `replay`
5. Premier test : enregistrer une session Claude Code complète
6. Écrire le README avec démo GIF

**Livrable** : `npx agentblackbox record -o "mon objectif" -- claude-code` fonctionne et enregistre tout.

### Phase 2 — "Les Yeux" (Semaines 3-4)
**Objectif** : Dashboard web pour visualiser les sessions.

Tâches :
1. Setup React + Vite + Tailwind
2. Page Sessions List
3. Page Session Detail avec Timeline
4. Diff Viewer pour les fichiers modifiés
5. Cost Tracker (graphiques)
6. Commande `agentblackbox serve`
7. WebSocket pour le live streaming

**Livrable** : Dashboard local fonctionnel avec visualisation complète.

### Phase 3 — "Le Cerveau" (Semaines 5-6)
**Objectif** : DriftDetect + Guardrails.

Tâches :
1. Implémenter le moteur DriftDetect (scorer heuristique + LLM)
2. Intégration Ollama pour le scoring local
3. Intégration API Anthropic/OpenAI optionnelle
4. Alertes dans le CLI (overlay Ink)
5. Alertes dans le dashboard (composant DriftAlert)
6. Guardrails engine avec les règles configurables
7. Courbe de drift dans le dashboard

**Livrable** : DriftDetect fonctionnel qui alerte quand l'agent diverge.

### Phase 4 — "Le Polish" (Semaine 7+)
**Objectif** : Prêt pour le lancement public.

Tâches :
1. Export HTML standalone (rapport de session)
2. Documentation complète
3. Tests unitaires et d'intégration
4. CI/CD (GitHub Actions)
5. Site web / landing page
6. Démo vidéo de 30 secondes
7. Post Twitter / Reddit / Hacker News

---

## 💰 Modèle de Monétisation

| Tier | Prix | Features |
|------|------|----------|
| **Open Source** | Gratuit | Core recording, replay, CLI, dashboard local, DriftDetect heuristique |
| **Pro** | $19/mois | DriftDetect LLM (cloud), guardrails avancés, export PDF, rétention illimitée, support prioritaire |
| **Team** | $49/mois/seat | Dashboard partagé, multi-utilisateurs, SSO, alerting Slack/Discord, comparaison entre développeurs |
| **Enterprise** | Custom | Self-hosted avec support, audit logs, compliance, intégrations custom |

---

## 📝 CLAUDE.md (Instructions pour Claude Code)

```markdown
# CLAUDE.md — AgentBlackBox

## Projet
AgentBlackBox est un outil d'observabilité pour agents IA.
Monorepo TypeScript avec pnpm + Turborepo.

## Structure
- `packages/core` : SDK Node.js (recorder, interceptors, storage, drift, guardrails)
- `packages/cli` : CLI (Commander.js + Ink)
- `packages/dashboard` : React + Vite + Tailwind

## Conventions
- TypeScript strict mode partout
- Noms de fichiers en kebab-case
- Exports nommés (pas de default exports sauf composants React)
- Tests avec Vitest
- Formatting avec Prettier (config dans package.json)
- ESLint avec la config recommandée TypeScript

## Commandes
- `pnpm install` : Installer les dépendances
- `pnpm dev` : Lancer le dev (tous les packages)
- `pnpm build` : Build production
- `pnpm test` : Lancer les tests
- `pnpm lint` : Linter

## Style de code
- Préfère les fonctions pures et l'immutabilité
- Utilise `Result<T, E>` pattern pour la gestion d'erreurs (pas de throw)
- Logging via un logger interne (pas de console.log direct)
- Tout le texte user-facing en anglais

## Base de données
- SQLite via better-sqlite3
- Schema dans `packages/core/src/storage/schema.ts`
- Migrations manuelles (pas d'ORM)

## DriftDetect
- Le prompt template est dans `packages/core/src/drift/prompts.ts`
- Supporte Ollama (local) et APIs cloud (Anthropic, OpenAI)
- Le scoring heuristique est le fallback quand aucun LLM n'est configuré
```

---

## 🎬 Stratégie de Lancement

1. **README impeccable** avec badges, GIF de démo, installation en une commande
2. **Démo vidéo 30s** : montrer un agent qui code → drift détecté → alerte → replay
3. **Post Hacker News** : "Show HN: AgentBlackBox — Flight recorder for AI agents with drift detection"
4. **Post Twitter/X** : Thread avec GIF + "I built a black box for AI agents. Here's what Claude Code actually does on your machine." (vise les comptes AI influents)
5. **Post Reddit** : r/LocalLLaMA, r/MachineLearning, r/programming
6. **Product Hunt** : Lancement avec screenshots du dashboard
