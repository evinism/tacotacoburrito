import { Box, Button, Paper, Typography } from "@mui/material";

export default function NotFound() {
  return (
    <Box sx={{ maxWidth: 600, margin: "auto", padding: "2rem" }}>
      <Paper
        elevation={4}
        sx={{
          padding: "2rem",
          backgroundColor: "#444444",
          borderRadius: "1rem",
          textAlign: "center",
        }}
      >
        <Typography variant="h3" sx={{ filter: "saturate(0.5)" }}>
          404
        </Typography>
        <Typography variant="body1" sx={{ color: "#999999", mt: 1, mb: 3 }}>
          This rhythm doesn&apos;t exist — that page is off the grid.
        </Typography>
        <Button href="/">Back to the metronome</Button>
      </Paper>
    </Box>
  );
}
