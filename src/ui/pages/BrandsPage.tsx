import React, { useEffect, useState } from "react";
import axios from "axios";
import { Alert, Button, Checkbox, FormControl, FormControlLabel, Grid, InputLabel, MenuItem, Select, Stack, TextField, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import SaveIcon from "@mui/icons-material/Save";
import { ConfirmDialog, EmptyState, LoadingState, PageHeader, SectionCard, StatusBadge } from "../components/v2";
import type { V2Brand } from "./v2Types";

const blankBrand: Partial<V2Brand> = {
  name: "",
  watermarkText: "",
  primaryColor: "#24545a",
  accentColor: "#d28b4c",
  captionStyle: "bold",
  includeOutro: true,
  outroText: "",
  contactText: "",
  isDefault: false,
};

const BrandsPage: React.FC = () => {
  const [brands, setBrands] = useState<V2Brand[]>([]);
  const [draft, setDraft] = useState<Partial<V2Brand>>(blankBrand);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<V2Brand | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    try {
      const response = await axios.get("/api/v2/brands");
      setBrands(response.data.brands || []);
      setError(null);
    } catch {
      setError("Failed to load brands.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const edit = (brand: V2Brand) => {
    setEditingId(brand.id);
    setDraft(brand);
  };

  const reset = () => {
    setEditingId(null);
    setDraft(blankBrand);
  };

  const save = async () => {
    try {
      if (editingId) {
        await axios.put(`/api/v2/brands/${editingId}`, draft);
        setMessage("Brand updated.");
      } else {
        await axios.post("/api/v2/brands", draft);
        setMessage("Brand created.");
      }
      reset();
      await load();
    } catch (err: any) {
      setError(err?.response?.data?.error || "Brand could not be saved.");
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    await axios.delete(`/api/v2/brands/${deleteTarget.id}`);
    setDeleteTarget(null);
    await load();
  };

  const setDefault = async (brand: V2Brand) => {
    await axios.post(`/api/v2/brands/${brand.id}/default`);
    await load();
  };

  if (loading) return <LoadingState label="Loading brands..." />;

  return (
    <>
      <PageHeader
        title="Brands"
        description="Persistent brand profiles stored in PostgreSQL and available to Create Video."
        actions={<Button startIcon={<AddIcon />} onClick={reset}>New Brand</Button>}
      />
      {message && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setMessage(null)}>{message}</Alert>}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <Grid container spacing={2}>
        <Grid item xs={12} lg={5}>
          <SectionCard title={editingId ? "Edit Brand" : "Create Brand"}>
            <Stack spacing={2}>
              <TextField required label="Brand Name" value={draft.name || ""} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              <TextField label="Watermark" value={draft.watermarkText || ""} onChange={(e) => setDraft({ ...draft, watermarkText: e.target.value })} />
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <TextField fullWidth type="color" label="Primary" value={draft.primaryColor || "#24545a"} onChange={(e) => setDraft({ ...draft, primaryColor: e.target.value })} />
                </Grid>
                <Grid item xs={6}>
                  <TextField fullWidth type="color" label="Accent" value={draft.accentColor || "#d28b4c"} onChange={(e) => setDraft({ ...draft, accentColor: e.target.value })} />
                </Grid>
              </Grid>
              <FormControl fullWidth>
                <InputLabel>Caption Style</InputLabel>
                <Select label="Caption Style" value={draft.captionStyle || "bold"} onChange={(e) => setDraft({ ...draft, captionStyle: e.target.value as any })}>
                  <MenuItem value="clean">Clean</MenuItem>
                  <MenuItem value="bold">Bold</MenuItem>
                  <MenuItem value="minimal">Minimal</MenuItem>
                </Select>
              </FormControl>
              <TextField label="Outro" value={draft.outroText || ""} onChange={(e) => setDraft({ ...draft, outroText: e.target.value })} />
              <TextField label="Contact" value={draft.contactText || ""} onChange={(e) => setDraft({ ...draft, contactText: e.target.value })} />
              <FormControlLabel control={<Checkbox checked={draft.includeOutro !== false} onChange={(e) => setDraft({ ...draft, includeOutro: e.target.checked })} />} label="Include outro" />
              <FormControlLabel control={<Checkbox checked={draft.isDefault === true} onChange={(e) => setDraft({ ...draft, isDefault: e.target.checked })} />} label="Default brand" />
              <Stack direction="row" spacing={1}>
                <Button variant="contained" startIcon={<SaveIcon />} disabled={!draft.name?.trim()} onClick={save}>Save</Button>
                {editingId && <Button onClick={reset}>Cancel</Button>}
              </Stack>
            </Stack>
          </SectionCard>
        </Grid>
        <Grid item xs={12} lg={7}>
          <Stack spacing={1.5}>
            {brands.map((brand) => (
              <SectionCard key={brand.id}>
                <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={2}>
                  <Stack spacing={0.75}>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                      <Typography variant="h6">{brand.name}</Typography>
                      {brand.isDefault && <StatusBadge status="ready" label="Default" />}
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      {brand.watermarkText || "No watermark"} · {brand.captionStyle} · {brand.contactText || "No contact"}
                    </Typography>
                    <Stack direction="row" spacing={1}>
                      <span style={{ width: 28, height: 18, background: brand.primaryColor, border: "1px solid #d0d5dd", borderRadius: 4 }} />
                      <span style={{ width: 28, height: 18, background: brand.accentColor, border: "1px solid #d0d5dd", borderRadius: 4 }} />
                    </Stack>
                  </Stack>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Button onClick={() => edit(brand)}>Edit</Button>
                    <Button disabled={brand.isDefault} onClick={() => setDefault(brand)}>Make Default</Button>
                    <Button color="error" startIcon={<DeleteIcon />} onClick={() => setDeleteTarget(brand)}>Delete</Button>
                  </Stack>
                </Stack>
              </SectionCard>
            ))}
            {brands.length === 0 && <EmptyState title="No brands yet" description="Create a brand profile to reuse colors, watermark, captions, outro, and contact details." />}
          </Stack>
        </Grid>
      </Grid>
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete brand?"
        description="Existing videos and job records are preserved. New videos will no longer offer this profile."
        confirmLabel="Delete"
        onClose={() => setDeleteTarget(null)}
        onConfirm={remove}
      />
    </>
  );
};

export default BrandsPage;
