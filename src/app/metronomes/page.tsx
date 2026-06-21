import type { Metadata } from "next";
import {
  Box,
  Divider,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Typography,
} from "@mui/material";
import { frontends } from "@/metronome/frontends";

export const metadata: Metadata = {
  title: "Metronomes",
};

export default function Frontends() {
  return (
    <Box sx={{ maxWidth: 600, margin: "auto", padding: "2rem" }}>
      <Paper
        elevation={4}
        sx={{
          padding: "2rem",
          backgroundColor: "#444444",
          borderRadius: "1rem",
        }}
      >
        <Typography variant="h5" sx={{ filter: "saturate(0.5)" }}>
          Metronomes
        </Typography>
        <Typography variant="body1" sx={{ color: "#666666" }}>
          one engine, many faces — pick a frontend
        </Typography>
        <Divider sx={{ my: 2 }} />
        <List>
          {frontends.map((frontend) => (
            <ListItemButton
              key={frontend.path}
              component="a"
              href={frontend.path}
              alignItems="flex-start"
              sx={{ borderRadius: "0.75rem" }}
            >
              <ListItemText
                primary={frontend.name}
                secondary={frontend.description}
              />
            </ListItemButton>
          ))}
        </List>
      </Paper>
    </Box>
  );
}
