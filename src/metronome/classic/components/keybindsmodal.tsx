import {
  Button,
  List,
  ListItem,
  Modal,
  Paper,
  Typography,
} from "@mui/material";

import SpaceBarIcon from "@mui/icons-material/SpaceBar";
import { ReactNode } from "react";

import styles from "@/metronome/classic/classic.module.css";

const K = ({ children }: { children: ReactNode }) => (
  <span className={styles.KeyRepresentation}>{children}</span>
);

const Keybinds = ({ close }: { close: () => void }) => {
  return (
    <Modal onClose={close} open={true} className={styles.KeybindsModal}>
      <Paper>
        <Typography variant="h5">Keyboard Shortcuts</Typography>
        <List>
          {[
            [<SpaceBarIcon key="space" />, "Play / Pause"],
            ["←", "Decrease Tempo"],
            ["→", "Increase Tempo"],
            ["/", "Tap Tempo"],
            [",", "Tap Rhythm (Strong Beat)"],
            [".", "Tap Rhythm (Weak Beat)"],
          ].map(([key, description]) => (
            <ListItem key={String(description)} className={styles.KBSLine}>
              <K>{key}</K> <span>{description}</span>
            </ListItem>
          ))}
        </List>
        <Button onClick={close}>Close</Button>
      </Paper>
    </Modal>
  );
};

export default Keybinds;
