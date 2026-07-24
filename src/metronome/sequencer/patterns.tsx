import {
  Box,
  Button,
  IconButton,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import SaveIcon from "@mui/icons-material/Save";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";

import { usePersistentState } from "@/hooks";

import { LIBRARY_PATTERNS } from "./library";
import styles from "./sequencer.module.css";

// The full sequencer state a pattern round-trips. Structurally compatible with
// the frontend's `Grid` without importing it, which would make this module and
// page.tsx circular.
export interface PatternState {
  bpm: number;
  steps: number;
  showEighths: boolean;
  bars: Record<string, boolean[]>[];
  // Pre-bars patterns stored a single grid; kept so old saves still load.
  grid?: Record<string, boolean[]>;
}

export interface SavedPattern extends PatternState {
  // Stable identity, so renaming a pattern isn't a delete-and-recreate and two
  // patterns may share a name.
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

const formatDate = (timestamp: number) =>
  new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export const usePatterns = () => {
  const [patterns, setPatterns] = usePersistentState<SavedPattern[]>(
    "sequencer/patterns",
    []
  );

  const update = (id: string, changes: Partial<SavedPattern>) =>
    setPatterns(
      patterns.map((pattern) =>
        pattern.id === id
          ? { ...pattern, ...changes, updatedAt: Date.now() }
          : pattern
      )
    );

  const saveNew = (state: PatternState) => {
    const now = Date.now();
    setPatterns([
      ...patterns,
      {
        ...state,
        id: crypto.randomUUID(),
        name: `Pattern ${patterns.length + 1}`,
        createdAt: now,
        updatedAt: now,
      },
    ]);
  };

  const overwrite = (id: string, state: PatternState) => update(id, state);
  const rename = (id: string, name: string) => update(id, { name });
  const remove = (id: string) =>
    setPatterns(patterns.filter((pattern) => pattern.id !== id));

  return { patterns, saveNew, overwrite, rename, remove };
};

interface PatternListProps {
  patterns: SavedPattern[];
  onLoad: (pattern: SavedPattern) => void;
  onOverwrite: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
}

const PatternList = ({
  patterns,
  onLoad,
  onOverwrite,
  onRename,
  onRemove,
}: PatternListProps) => {
  // Display-only ordering — the underlying store keeps insertion order.
  const [newestFirst, setNewestFirst] = usePersistentState<boolean>(
    "sequencer/patternsNewestFirst",
    true
  );

  const sorted = patterns
    .slice()
    .sort((a, b) =>
      newestFirst ? b.updatedAt - a.updatedAt : a.updatedAt - b.updatedAt
    );

  return (
    <>
      <Box className={styles.PatternsHeader}>
        <Typography variant="h6" className={styles.PatternsTitle}>
          Saved Patterns
        </Typography>
        <div className={styles.Spacer} />
        {patterns.length > 0 && (
          <Button
            size="small"
            onClick={() => setNewestFirst(!newestFirst)}
            startIcon={
              newestFirst ? (
                <ArrowDownwardIcon fontSize="small" />
              ) : (
                <ArrowUpwardIcon fontSize="small" />
              )
            }
          >
            {newestFirst ? "Newest first" : "Oldest first"}
          </Button>
        )}
      </Box>
      {patterns.length === 0 ? (
        <Typography variant="body2" className={styles.PatternsEmpty}>
          No saved patterns yet — use “Save as New” to keep the current one.
        </Typography>
      ) : (
        <PatternRows
          patterns={sorted}
          onLoad={onLoad}
          onOverwrite={onOverwrite}
          onRename={onRename}
          onRemove={onRemove}
        />
      )}
    </>
  );
};

const PatternRows = ({
  patterns,
  onLoad,
  onOverwrite,
  onRename,
  onRemove,
}: PatternListProps) => {
  return (
    <Box className={styles.Patterns}>
      {patterns.map((pattern) => (
        <div key={pattern.id} className={styles.PatternRow}>
          <TextField
            className={styles.PatternName}
            variant="standard"
            size="small"
            value={pattern.name}
            onChange={(event) => onRename(pattern.id, event.target.value)}
            aria-label="Pattern name"
          />
          <Typography variant="caption" className={styles.PatternDate}>
            {formatDate(pattern.updatedAt)}
          </Typography>
          <Tooltip title="Load this pattern" enterDelay={500}>
            <IconButton
              size="small"
              aria-label={`Load ${pattern.name}`}
              onClick={() => onLoad(pattern)}
            >
              <Typography variant="button">Load</Typography>
            </IconButton>
          </Tooltip>
          <Tooltip title="Replace with the current pattern" enterDelay={500}>
            <IconButton
              size="small"
              aria-label={`Overwrite ${pattern.name}`}
              onClick={() => {
                if (confirm(`Replace "${pattern.name}" with the current pattern?`)) {
                  onOverwrite(pattern.id);
                }
              }}
            >
              <SaveIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Delete this pattern" enterDelay={500}>
            <IconButton
              size="small"
              aria-label={`Delete ${pattern.name}`}
              onClick={() => {
                if (confirm(`Delete "${pattern.name}"?`)) {
                  onRemove(pattern.id);
                }
              }}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </div>
      ))}
    </Box>
  );
};

// Built-in patterns: loadable, but with no rename/overwrite/delete affordances,
// since the library ships with the app rather than living in localStorage.
export const LibraryList = ({
  onLoad,
}: {
  onLoad: (pattern: PatternState) => void;
}) => (
  <>
    <Box className={styles.PatternsHeader}>
      <Typography variant="h6" className={styles.PatternsTitle}>
        Pattern Library
      </Typography>
    </Box>
    {LIBRARY_PATTERNS.length === 0 ? (
      <Typography variant="body2" className={styles.PatternsEmpty}>
        The built-in library is empty for now.
      </Typography>
    ) : (
      <Box className={styles.Patterns}>
        {LIBRARY_PATTERNS.map((pattern) => (
          <div key={pattern.name} className={styles.PatternRow}>
            <Typography variant="body2" className={styles.PatternName}>
              {pattern.name}
            </Typography>
            <Tooltip title="Load this pattern" enterDelay={500}>
              <IconButton
                size="small"
                aria-label={`Load ${pattern.name}`}
                onClick={() => onLoad(pattern)}
              >
                <Typography variant="button">Load</Typography>
              </IconButton>
            </Tooltip>
          </div>
        ))}
      </Box>
    )}
  </>
);

export default PatternList;
