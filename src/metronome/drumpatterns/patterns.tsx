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
import styles from "./drumpatterns.module.css";

// The full grid state a pattern round-trips. Structurally compatible with
// the frontend's `Grid` without importing it, which would make this module and
// page.tsx circular.
export interface PatternState {
  bpm: number;
  // Eighth-note columns; the UI counts them in quarter notes.
  steps: number;
  // All-rest rows may be omitted — the frontend fills them back in.
  bars: Record<string, boolean[]>[];
}

export interface PatternVariant extends PatternState {
  // Stable identity for the React key and for "which variant is selected",
  // neither of which can key off position while variants are being added.
  id: string;
  createdAt: number;
  updatedAt: number;
}

// A named group of variants of one rhythm. Only the group is named; a variant
// is identified by its position in the row (1-based), like the library's.
export interface PatternGroup {
  id: string;
  name: string;
  // The rhythm's whole commentary — its grouping, the songs it's played for,
  // what distinguishes each variant — in one freeform block. Notes about a
  // particular variant go on their own line, prefixed with its number.
  notes?: string;
  variants: PatternVariant[];
}

// How a variant's own line reads inside that block. Also the shape the library
// composes, so both stores present commentary the same way.
export const variantNoteLine = (variant: number, notes: string) =>
  `\n${variant}. ${notes}`;


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

// BPM always counts quarter notes and the grid is always eighths, so a pattern
// spans half as many beats as it has columns. Only used to title the library's
// sections.
const beatCount = (pattern: PatternState) => pattern.steps / 2;

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
    "drumpatterns/patternGroups",
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

  // Returns where the new pattern landed so the caller can select it — with
  // one combined dropdown, a save that didn't move the selection would look
  // like nothing happened.
  const saveNew = (state: PatternState): NoteTarget => {
    const variant = newVariant(state);
    const group: PatternGroup = {
      id: crypto.randomUUID(),
      name: `Pattern ${groups.length + 1}`,
      variants: [variant],
    };
    setGroups([...groups, group]);
    return { kind: "saved", groupId: group.id, variantId: variant.id };
  };

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

  const setNotes = (groupId: string, notes: string) =>
    updateGroup(groupId, (group) => ({ ...group, notes }));

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
    setNotes,
    removeVariant,
  };
};

// Hoisted so usePersistentState's defaults keep a stable identity across
// renders (they feed a useCallback dependency list).
const NO_GROUPS: PatternGroup[] = [];

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
const selectionKey = (target: NoteTarget): string | null =>
  target === null ? null : target.kind === "library" ? target.name : target.variantId;

interface NoteField {
  label: string;
  value: string;
  // Absent for the built-in library, which ships with the app and so reads as
  // documentation rather than as a notebook.
  onChange?: (notes: string) => void;
}

// Small type throughout: these are annotations on the pattern above them, not
// the main event.
const NOTE_FONT = { fontSize: "0.8rem" };

const NoteBox = ({ label, value, onChange, placeholder }: NoteField & {
  placeholder: string;
}) =>
  onChange ? (
    <TextField
      size="small"
      fullWidth
      multiline
      minRows={2}
      variant="outlined"
      label={label}
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      slotProps={{
        input: { sx: NOTE_FONT },
        inputLabel: { sx: NOTE_FONT },
      }}
    />
  ) : value ? (
    // Read-only: plain text rather than a disabled field, which would read as
    // "you could edit this but not right now".
    <Typography variant="body2" className={styles.ReadOnlyNote} sx={NOTE_FONT}>
      <span className={styles.NoteLabel}>{label}</span>
      {value}
    </Typography>
  ) : null;

/*
  The metadata for whatever is loaded, rendered under the picker it belongs to.
  Split in two: what's true of the whole rhythm on the left, what's true of
  this one variant on the right.
*/
export const PatternNotes = ({
  target,
  groups,
  onSetNotes,
}: {
  target: NoteTarget;
  groups: PatternGroup[];
  onSetNotes: (groupId: string, notes: string) => void;
}) => {
  if (!target) return null;

  const resolve = (): NoteField | null => {
    if (target.kind === "library") {
      const family = LIBRARY_FAMILIES.find(
        (candidate) => candidate.family === target.family
      );
      if (!family) return null;
      // The library keeps its notes split across familyNotes and each
      // pattern's own line; compose them into the one block the UI shows.
      return {
        label: "Commentary — ",
        value: [
          LIBRARY_FAMILY_NOTES[target.family] ?? "",
          ...family.members.map(({ pattern, variant }, index) =>
            pattern.notes
              ? variantNoteLine(variant ?? index + 1, pattern.notes)
              : ""
          ),
        ]
          .join("")
          .trimStart(),
      };
    }
    const group = groups.find((candidate) => candidate.id === target.groupId);
    if (!group) return null;
    return {
      label: "Commentary",
      value: group.notes ?? "",
      onChange: (notes) => onSetNotes(group.id, notes),
    };
  };

  const resolved = resolve();
  if (!resolved) return null;

  return (
    <div className={styles.PatternNotes}>
      <NoteBox
        {...resolved}
        placeholder="Grouping, songs, what each variant does differently"
      />
    </div>
  );
};

/*
  Library families are bucketed by cycle length, since that's how these rhythms
  are actually grouped in practice (a 9-beat Karsilama and a 7-beat Kalamatiano
  are unrelated even though both are "a Greek rhythm"). The buckets are the
  dropdown's subheaders. A family's length comes from its first member;
  variants of one family never disagree on step count in practice, and if one
  did it would only mis-file that family, not break loading.
*/
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

/*
  Both the built-in library and the user's own patterns live in one dropdown,
  the saved ones under a "Custom" subheader at the bottom — the same shape the
  classic frontend's preset list uses. Option values carry which store they
  came from, since a library family is keyed by name and a saved group by id.
*/
const libraryValue = (family: string) => `library:${family}`;
const savedValue = (groupId: string) => `saved:${groupId}`;

/*
  Which option the dropdown shows, derived from the loaded pattern rather than
  held locally: selection and "what you're hearing" are the same thing. Doubles
  as the identity of the family a selection belongs to, which is how the
  frontend tells a variant switch from a family switch.
*/
export const familyKey = (target: NoteTarget): string =>
  target === null
    ? ""
    : target.kind === "library"
      ? libraryValue(target.family)
      : savedValue(target.groupId);

interface PatternLibraryProps {
  groups: PatternGroup[];
  target: NoteTarget;
  onLoad: (pattern: PatternState, target: NoteTarget) => void;
  onAddVariant: (groupId: string) => void;
  onOverwrite: (groupId: string, variantId: string) => void;
  onRenameGroup: (groupId: string, name: string) => void;
  onRemoveVariant: (groupId: string, variantId: string) => void;
}

const PatternLibrary = ({
  groups,
  target,
  onLoad,
  onAddVariant,
  onOverwrite,
  onRenameGroup,
  onRemoveVariant,
}: PatternLibraryProps) => {
  // Display-only ordering of the saved section — the underlying store keeps
  // insertion order.
  const [newestFirst, setNewestFirst] = usePersistentState<boolean>(
    "drumpatterns/patternsNewestFirst",
    true
  );

  const selected = selectionKey(target);

  const lastTouched = (group: PatternGroup) =>
    Math.max(...group.variants.map((variant) => variant.updatedAt));

  const sortedGroups = groups
    .slice()
    .sort((a, b) =>
      newestFirst
        ? lastTouched(b) - lastTouched(a)
        : lastTouched(a) - lastTouched(b)
    );

  const family =
    target?.kind === "library"
      ? LIBRARY_FAMILIES.find((entry) => entry.family === target.family)
      : undefined;
  const group =
    target?.kind === "saved"
      ? groups.find((candidate) => candidate.id === target.groupId)
      : undefined;
  const openVariant = group?.variants.find(
    (variant) => variant.id === selected
  );

  const chooseLibrary = (pattern: LibraryPattern) =>
    onLoad(pattern, {
      kind: "library",
      family: parseName(pattern.name).family,
      name: pattern.name,
    });

  const chooseSaved = (group: PatternGroup, variant: PatternVariant) =>
    onLoad(variant, {
      kind: "saved",
      groupId: group.id,
      variantId: variant.id,
    });

  // Picking a rhythm drops straight onto its first variant, so choosing a
  // pattern is one click rather than two.
  const choose = (value: string) => {
    const [kind, key] = [value.slice(0, value.indexOf(":")), value.slice(value.indexOf(":") + 1)];
    if (kind === "library") {
      const next = LIBRARY_FAMILIES.find((entry) => entry.family === key);
      if (next) chooseLibrary(next.members[0].pattern);
      return;
    }
    const next = groups.find((candidate) => candidate.id === key);
    if (next) chooseSaved(next, next.variants[0]);
  };

  return (
    <>
      <Box className={styles.PatternsHeader}>
        <Typography variant="h6" className={styles.PatternsTitle}>
          Pattern Library
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
      <div className={styles.FamilyRow}>
        <Select
          className={styles.FamilySelect}
          size="small"
          variant="standard"
          displayEmpty
          value={familyKey(target)}
          onChange={(event) => choose(event.target.value)}
          aria-label="Rhythm"
        >
          <MenuItem value="" disabled>
            Choose a rhythm…
          </MenuItem>
          {LIBRARY_SECTIONS.flatMap(({ beats, families }) => [
            <ListSubheader key={`beats-${beats}`}>{beats} beats</ListSubheader>,
            ...families.map(({ family: name }) => (
              <MenuItem key={name} value={libraryValue(name)}>
                {name}
              </MenuItem>
            )),
          ])}
          {/* Saved patterns last: the built-ins are the common case, and a
              user's own patterns are easiest to find at a fixed end. */}
          {groups.length > 0 && (
            <ListSubheader key="custom">Custom</ListSubheader>
          )}
          {sortedGroups.map((candidate) => (
            <MenuItem key={candidate.id} value={savedValue(candidate.id)}>
              {candidate.name}
            </MenuItem>
          ))}
        </Select>
        {family && (
          <VariantButtons
            variants={family.members}
            keyOf={({ pattern }) => pattern.name}
            labelOf={({ variant }, index) => String(variant ?? index + 1)}
            selected={selected}
            onSelect={({ pattern }) => chooseLibrary(pattern)}
          />
        )}
        {/* Saved patterns are editable in place; library entries ship with the
            app, so they get no rename/overwrite/delete affordances. */}
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
              onSelect={(variant) => chooseSaved(group, variant)}
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
        {group && openVariant && (
          <>
            <div className={styles.Spacer} />
            <Typography variant="caption" className={styles.PatternDate}>
              {formatDate(openVariant.updatedAt)}
            </Typography>
            <Tooltip title="Replace with the current pattern" enterDelay={500}>
              <IconButton
                size="small"
                aria-label="Overwrite this variant"
                onClick={() => {
                  if (confirm("Replace this variant with the current pattern?")) {
                    onOverwrite(group.id, openVariant.id);
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
                    onRemoveVariant(group.id, openVariant.id);
                  }
                }}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </>
        )}
      </div>
    </>
  );
};

export default PatternLibrary;
