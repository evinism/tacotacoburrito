import { useState } from "react";

import {
  Box,
  Button,
  IconButton,
  ListSubheader,
  MenuItem,
  Select,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import SaveIcon from "@mui/icons-material/Save";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";

import { usePersistentState } from "@/hooks";

import {
  LIBRARY_FAMILY_NOTES,
  LIBRARY_PATTERNS,
  type LibraryPattern,
} from "./library";
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

export interface PatternVariant extends PatternState {
  // Stable identity for the React key and for "which variant is selected",
  // neither of which can key off position while variants are being added.
  id: string;
  // Freeform metadata — song titles, "running", "3-2-2-2 version". Variants
  // aren't named individually, so this is where anything distinguishing them
  // goes. Not sequencer state, so loading a variant never touches it.
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

// A named group of variants of one rhythm. Only the group is named; a variant
// is identified by its position in the row (1-based), like the library's.
export interface PatternGroup {
  id: string;
  name: string;
  // Freeform metadata about the rhythm as a whole — its grouping, the songs
  // it's played for — as opposed to a single variant's `notes`.
  notes?: string;
  variants: PatternVariant[];
}

/*
  The library groups by naming convention instead of structure: a trailing
  number makes a variant of a family ("Kalamatiano 3"). library.json is a flat
  list of names, and keeping it that way means adding a pattern there is a
  one-line append rather than a nesting exercise.
*/
const NAME_PATTERN = /^(.*?)\s+(\d+)$/;

const parseName = (name: string) => {
  const match = NAME_PATTERN.exec(name);
  return match
    ? { family: match[1], variant: Number(match[2]) }
    : // A name with no trailing number is a family of one.
      { family: name, variant: null };
};

interface Family {
  family: string;
  members: { pattern: LibraryPattern; variant: number | null }[];
}

// Families keep first-appearance order; members sort by variant number, since
// within a family the numbering *is* the meaningful order.
const groupByFamily = (patterns: LibraryPattern[]): Family[] => {
  const families = new Map<string, Family>();
  for (const pattern of patterns) {
    const { family, variant } = parseName(pattern.name);
    const entry = families.get(family) ?? { family, members: [] };
    entry.members.push({ pattern, variant });
    families.set(family, entry);
  }
  return [...families.values()].map((entry) => ({
    ...entry,
    members: entry.members
      .slice()
      .sort((a, b) => (a.variant ?? 0) - (b.variant ?? 0)),
  }));
};

// BPM always counts quarter notes, so an eighth-resolution pattern spans half
// as many beats as it has columns. Used only to title the library's sections.
const beatCount = (pattern: PatternState) =>
  pattern.showEighths ? pattern.steps / 2 : pattern.steps;

const formatDate = (timestamp: number) =>
  new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

const newVariant = (state: PatternState): PatternVariant => {
  const now = Date.now();
  return { ...state, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
};

export const usePatterns = () => {
  const [groups, setGroups] = usePersistentState<PatternGroup[]>(
    "sequencer/patternGroups",
    NO_GROUPS
  );

  const updateGroup = (id: string, change: (group: PatternGroup) => PatternGroup) =>
    setGroups(groups.map((group) => (group.id === id ? change(group) : group)));

  const updateVariant = (
    groupId: string,
    variantId: string,
    changes: Partial<PatternVariant>
  ) =>
    updateGroup(groupId, (group) => ({
      ...group,
      variants: group.variants.map((variant) =>
        variant.id === variantId ? { ...variant, ...changes } : variant
      ),
    }));

  const saveNew = (state: PatternState) =>
    setGroups([
      ...groups,
      {
        id: crypto.randomUUID(),
        name: `Pattern ${groups.length + 1}`,
        variants: [newVariant(state)],
      },
    ]);

  const addVariant = (groupId: string, state: PatternState) =>
    updateGroup(groupId, (group) => ({
      ...group,
      variants: [...group.variants, newVariant(state)],
    }));

  const overwrite = (groupId: string, variantId: string, state: PatternState) =>
    updateVariant(groupId, variantId, { ...state, updatedAt: Date.now() });

  // Renaming and note-taking deliberately leave updatedAt alone: it drives the
  // group ordering, and bumping it mid-keystroke would shuffle the list out
  // from under the cursor.
  const renameGroup = (groupId: string, name: string) =>
    updateGroup(groupId, (group) => ({ ...group, name }));

  const setGroupNotes = (groupId: string, notes: string) =>
    updateGroup(groupId, (group) => ({ ...group, notes }));

  const setNotes = (groupId: string, variantId: string, notes: string) =>
    updateVariant(groupId, variantId, { notes });

  // The group exists to hold variants, so emptying it removes it.
  const removeVariant = (groupId: string, variantId: string) =>
    setGroups(
      groups.flatMap((group) => {
        if (group.id !== groupId) return [group];
        const variants = group.variants.filter(
          (variant) => variant.id !== variantId
        );
        return variants.length > 0 ? [{ ...group, variants }] : [];
      })
    );

  return {
    groups,
    saveNew,
    addVariant,
    overwrite,
    renameGroup,
    setGroupNotes,
    setNotes,
    removeVariant,
  };
};

// Hoisted so usePersistentState's defaults keep a stable identity across
// renders (they feed a useCallback dependency list).
const NO_GROUPS: PatternGroup[] = [];
const NO_EDITS: Record<string, string> = {};

// One row of variant buttons. Selecting a variant also loads it, so the notes
// box below always describes what you're currently hearing.
const VariantButtons = <T,>({
  variants,
  keyOf,
  labelOf,
  selected,
  onSelect,
}: {
  variants: T[];
  keyOf: (variant: T, index: number) => string;
  labelOf: (variant: T, index: number) => string;
  selected: string | null;
  onSelect: (variant: T) => void;
}) => (
  <div className={styles.Variants}>
    {variants.map((variant, index) => (
      <Button
        key={keyOf(variant, index)}
        size="small"
        variant={keyOf(variant, index) === selected ? "contained" : "text"}
        className={styles.VariantButton}
        aria-label={`Load variant ${labelOf(variant, index)}`}
        onClick={() => onSelect(variant)}
      >
        {labelOf(variant, index)}
      </Button>
    ))}
  </div>
);

/*
  Which variant's notes are on screen. Selection is single across both lists —
  only one pattern is loaded at a time, so only one set of notes is relevant —
  which is why it's owned by the frontend rather than by either list.
*/
export type NoteTarget =
  | { kind: "library"; family: string; name: string }
  | { kind: "saved"; groupId: string; variantId: string }
  | null;

// The key a list uses to highlight its selected variant button.
export const selectionKey = (target: NoteTarget): string | null =>
  target === null ? null : target.kind === "library" ? target.name : target.variantId;

// Library notes are editable but library.json ships read-only, so edits live
// in localStorage and shadow the built-in text — keyed by pattern name for
// variant notes, by family name for family notes.
const useLibraryNotes = (key: string) =>
  usePersistentState<Record<string, string>>(key, NO_EDITS);

interface NoteField {
  label: string;
  value: string;
  onChange: (notes: string) => void;
}

const NoteBox = ({ label, value, onChange, placeholder }: NoteField & {
  placeholder: string;
}) => (
  <TextField
    size="small"
    fullWidth
    multiline
    minRows={3}
    variant="outlined"
    label={label}
    placeholder={placeholder}
    value={value}
    onChange={(event) => onChange(event.target.value)}
  />
);

/*
  The metadata boxes, rendered under the grid rather than inside either list so
  they stay visible while you audition variants. Split in two: what's true of
  the whole rhythm on the left, what's true of this one variant on the right.
*/
export const PatternNotes = ({
  target,
  groups,
  onSetGroupNotes,
  onSetVariantNotes,
}: {
  target: NoteTarget;
  groups: PatternGroup[];
  onSetGroupNotes: (groupId: string, notes: string) => void;
  onSetVariantNotes: (groupId: string, variantId: string, notes: string) => void;
}) => {
  const [variantEdits, setVariantEdits] = useLibraryNotes(
    "sequencer/libraryNotes"
  );
  const [familyEdits, setFamilyEdits] = useLibraryNotes(
    "sequencer/libraryFamilyNotes"
  );
  if (!target) return null;

  const resolve = (): { family: NoteField; variant: NoteField } | null => {
    if (target.kind === "library") {
      const pattern = LIBRARY_PATTERNS.find(
        (candidate) => candidate.name === target.name
      );
      if (!pattern) return null;
      return {
        family: {
          label: `${target.family} — rhythm notes`,
          value:
            familyEdits[target.family] ??
            LIBRARY_FAMILY_NOTES[target.family] ??
            "",
          onChange: (notes) =>
            setFamilyEdits({ ...familyEdits, [target.family]: notes }),
        },
        variant: {
          label: `${pattern.name} — variant notes`,
          value: variantEdits[pattern.name] ?? pattern.notes ?? "",
          onChange: (notes) =>
            setVariantEdits({ ...variantEdits, [pattern.name]: notes }),
        },
      };
    }
    const group = groups.find((candidate) => candidate.id === target.groupId);
    const index =
      group?.variants.findIndex((variant) => variant.id === target.variantId) ??
      -1;
    if (!group || index < 0) return null;
    return {
      family: {
        label: `${group.name} — rhythm notes`,
        value: group.notes ?? "",
        onChange: (notes) => onSetGroupNotes(group.id, notes),
      },
      variant: {
        label: `${group.name} ${index + 1} — variant notes`,
        value: group.variants[index].notes ?? "",
        onChange: (notes) =>
          onSetVariantNotes(group.id, target.variantId, notes),
      },
    };
  };

  const resolved = resolve();
  if (!resolved) return null;

  return (
    <div className={styles.PatternNotes}>
      <NoteBox
        {...resolved.family}
        placeholder="Grouping, songs, anything true of the whole rhythm"
      />
      <NoteBox
        {...resolved.variant}
        placeholder="What makes this variant different"
      />
    </div>
  );
};

interface PatternListProps {
  groups: PatternGroup[];
  selected: string | null;
  onLoad: (variant: PatternVariant, target: NoteTarget) => void;
  onAddVariant: (groupId: string) => void;
  onOverwrite: (groupId: string, variantId: string) => void;
  onRenameGroup: (groupId: string, name: string) => void;
  onRemoveVariant: (groupId: string, variantId: string) => void;
}

const PatternList = ({
  groups,
  selected,
  onLoad,
  onAddVariant,
  onOverwrite,
  onRenameGroup,
  onRemoveVariant,
}: PatternListProps) => {
  // Display-only ordering — the underlying store keeps insertion order.
  const [newestFirst, setNewestFirst] = usePersistentState<boolean>(
    "sequencer/patternsNewestFirst",
    true
  );
  // Only one group's variants are on screen at a time; the dropdown swaps
  // them. Not persisted, so a reload never loads a pattern over the grid you
  // left behind.
  const [groupId, setGroupId] = useState<string | null>(null);

  const lastTouched = (group: PatternGroup) =>
    Math.max(...group.variants.map((variant) => variant.updatedAt));

  const sorted = groups
    .slice()
    .sort((a, b) =>
      newestFirst ? lastTouched(b) - lastTouched(a) : lastTouched(a) - lastTouched(b)
    );

  const group = groups.find((candidate) => candidate.id === groupId);
  const open = group?.variants.find((variant) => variant.id === selected);

  const choose = (group: PatternGroup, variant: PatternVariant) =>
    onLoad(variant, {
      kind: "saved",
      groupId: group.id,
      variantId: variant.id,
    });

  // Picking a group drops straight onto its first variant, so choosing a
  // pattern is one click rather than two.
  const chooseGroup = (id: string) => {
    setGroupId(id);
    const next = groups.find((candidate) => candidate.id === id);
    if (next) choose(next, next.variants[0]);
  };

  return (
    <>
      <Box className={styles.PatternsHeader}>
        <Typography variant="h6" className={styles.PatternsTitle}>
          Saved Patterns
        </Typography>
        <div className={styles.Spacer} />
        {groups.length > 0 && (
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
      {groups.length === 0 ? (
        <Typography variant="body2" className={styles.PatternsEmpty}>
          No saved patterns yet — use “Save as New” to keep the current one.
        </Typography>
      ) : (
        <div className={styles.FamilyRow}>
          <Select
            className={styles.FamilySelect}
            size="small"
            variant="standard"
            displayEmpty
            value={group?.id ?? ""}
            onChange={(event) => chooseGroup(event.target.value)}
            aria-label="Saved pattern group"
          >
            <MenuItem value="" disabled>
              Choose a saved pattern…
            </MenuItem>
            {sorted.map((candidate) => (
              <MenuItem key={candidate.id} value={candidate.id}>
                {candidate.name}
              </MenuItem>
            ))}
          </Select>
          {group && (
            <>
              <TextField
                className={styles.FamilyName}
                variant="standard"
                size="small"
                value={group.name}
                onChange={(event) => onRenameGroup(group.id, event.target.value)}
                aria-label="Pattern group name"
              />
              <VariantButtons
                variants={group.variants}
                keyOf={(variant) => variant.id}
                labelOf={(_, index) => String(index + 1)}
                selected={selected}
                onSelect={(variant) => choose(group, variant)}
              />
              <Tooltip
                title={`Save the current pattern as a new "${group.name}" variant`}
                enterDelay={500}
              >
                <IconButton
                  size="small"
                  aria-label={`Add a variant to ${group.name}`}
                  onClick={() => onAddVariant(group.id)}
                >
                  <AddIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </>
          )}
          {group && open && (
            <>
              <div className={styles.Spacer} />
              <Typography variant="caption" className={styles.PatternDate}>
                {formatDate(open.updatedAt)}
              </Typography>
              <Tooltip title="Replace with the current pattern" enterDelay={500}>
                <IconButton
                  size="small"
                  aria-label="Overwrite this variant"
                  onClick={() => {
                    if (confirm("Replace this variant with the current pattern?")) {
                      onOverwrite(group.id, open.id);
                    }
                  }}
                >
                  <SaveIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Delete this variant" enterDelay={500}>
                <IconButton
                  size="small"
                  aria-label="Delete this variant"
                  onClick={() => {
                    if (confirm("Delete this variant?")) {
                      onRemoveVariant(group.id, open.id);
                    }
                  }}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </>
          )}
        </div>
      )}
    </>
  );
};

// Library families are bucketed by cycle length, since that's how these
// rhythms are actually grouped in practice (a 9-beat Karsilama and a 7-beat
// Kalamatiano are unrelated even though both are "a Greek rhythm"). The
// buckets are the dropdown's subheaders. A family's length comes from its
// first member; variants of one family never disagree on step count in
// practice, and if one did it would only mis-file that family, not break
// loading.
const LIBRARY_SECTIONS = (() => {
  const sections = new Map<number, Family[]>();
  for (const family of groupByFamily(LIBRARY_PATTERNS)) {
    const beats = beatCount(family.members[0].pattern);
    sections.set(beats, [...(sections.get(beats) ?? []), family]);
  }
  return [...sections.entries()]
    .sort(([a], [b]) => a - b)
    .map(([beats, families]) => ({ beats, families }));
})();

const LIBRARY_FAMILIES = LIBRARY_SECTIONS.flatMap(({ families }) => families);

// Built-in patterns: loadable, but with no rename/overwrite/delete affordances,
// since the library ships with the app rather than living in localStorage.
export const LibraryList = ({
  selected,
  onLoad,
}: {
  selected: string | null;
  onLoad: (pattern: PatternState, target: NoteTarget) => void;
}) => {
  const [family, setFamily] = useState<string | null>(null);

  const current = LIBRARY_FAMILIES.find((entry) => entry.family === family);

  const choose = (pattern: LibraryPattern) =>
    onLoad(pattern, {
      kind: "library",
      family: parseName(pattern.name).family,
      name: pattern.name,
    });

  const chooseFamily = (name: string) => {
    setFamily(name);
    const next = LIBRARY_FAMILIES.find((entry) => entry.family === name);
    if (next) choose(next.members[0].pattern);
  };

  return (
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
        <div className={styles.FamilyRow}>
          <Select
            className={styles.FamilySelect}
            size="small"
            variant="standard"
            displayEmpty
            value={current?.family ?? ""}
            onChange={(event) => chooseFamily(event.target.value)}
            aria-label="Library rhythm"
          >
            <MenuItem value="" disabled>
              Choose a rhythm…
            </MenuItem>
            {LIBRARY_SECTIONS.flatMap(({ beats, families }) => [
              <ListSubheader key={`beats-${beats}`}>{beats} beats</ListSubheader>,
              ...families.map(({ family: name }) => (
                <MenuItem key={name} value={name}>
                  {name}
                </MenuItem>
              )),
            ])}
          </Select>
          {current && (
            <VariantButtons
              variants={current.members}
              keyOf={({ pattern }) => pattern.name}
              labelOf={({ variant }, index) => String(variant ?? index + 1)}
              selected={selected}
              onSelect={({ pattern }) => choose(pattern)}
            />
          )}
        </div>
      )}
    </>
  );
};

export default PatternList;
