"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { updateDamageReport } from "@/lib/db";
import type { Claim, UserRole } from "@/lib/supabase";

const schema = z.object({
  damage_type: z.string().optional(),
  affected_units: z.coerce.number().int().min(0).optional(),
  total_units: z.coerce.number().int().min(0).optional(),
  estimated_loss_usd: z.coerce.number().min(0).optional(),
  damage_location: z.string().optional(),
  damage_description: z.string().optional(),
  temperature_log_present: z.boolean().optional(),
  inspector_name: z.string().optional(),
  inspection_date: z.string().optional(),
  stuffing_date: z.string().optional(),
  release_date: z.string().optional(),
  waste_percentage: z.coerce.number().min(0).max(100).optional(),
});

type FormValues = z.infer<typeof schema>;

const DAMAGE_TYPES = ["Moisture", "Physical", "Temperature", "Contamination", "Other"];

function ReadField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] text-gray-400 uppercase tracking-wide mb-0.5">{label}</p>
      <p className="text-sm font-medium text-gray-800">{value ?? "—"}</p>
    </div>
  );
}

interface DamageReportFormProps {
  claim: Claim;
  role: UserRole;
}

export function DamageReportForm({ claim, role }: DamageReportFormProps) {
  const queryClient = useQueryClient();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      damage_type: claim.damage_type ?? "",
      affected_units: claim.affected_units ?? ("" as unknown as number),
      total_units: claim.total_units ?? ("" as unknown as number),
      estimated_loss_usd: claim.estimated_loss_usd ?? ("" as unknown as number),
      damage_location: claim.damage_location ?? "",
      damage_description: claim.damage_description ?? "",
      temperature_log_present: claim.temperature_log_present ?? false,
      inspector_name: claim.inspector_name ?? "",
      inspection_date: claim.inspection_date ?? "",
      stuffing_date: claim.stuffing_date ?? "",
      release_date: claim.release_date ?? "",
      waste_percentage: claim.waste_percentage ?? ("" as unknown as number),
    },
  });

  const { mutate, isPending } = useMutation({
    mutationFn: (values: FormValues) => updateDamageReport(claim.id, values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["claim", claim.id] });
      toast.success("Damage report saved.");
    },
    onError: () => toast.error("Failed to save damage report."),
  });

  // Supplier sees read-only view
  if (role === "supplier") {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Damage Report</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <ReadField label="Damage Type" value={claim.damage_type} />
            <ReadField label="Affected Units" value={claim.affected_units} />
            <ReadField label="Total Units" value={claim.total_units} />
            <ReadField
              label="Estimated Loss (USD)"
              value={
                claim.estimated_loss_usd != null
                  ? `$${claim.estimated_loss_usd.toLocaleString()}`
                  : null
              }
            />
            <ReadField label="Damage Location" value={claim.damage_location} />
            <ReadField label="Inspector" value={claim.inspector_name} />
            <ReadField
              label="Inspection Date"
              value={
                claim.inspection_date
                  ? new Date(claim.inspection_date).toLocaleDateString()
                  : null
              }
            />
            <ReadField
              label="Temperature Log Present"
              value={claim.temperature_log_present ? "Yes" : "No"}
            />
            <ReadField label="Waste %" value={claim.waste_percentage != null ? `${claim.waste_percentage}%` : null} />
          </div>
          {claim.damage_description && (
            <div className="mt-4">
              <p className="text-[11px] text-gray-400 uppercase tracking-wide mb-0.5">Description</p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{claim.damage_description}</p>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Damage Report</CardTitle>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutate(v))} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField control={form.control} name="damage_type" render={({ field }) => (
                <FormItem>
                  <FormLabel>Damage Type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger><SelectValue placeholder="Select type…" /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {DAMAGE_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="damage_location" render={({ field }) => (
                <FormItem>
                  <FormLabel>Damage Location</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Top layer, Full container" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="affected_units" render={({ field }) => (
                <FormItem>
                  <FormLabel>Affected Units</FormLabel>
                  <FormControl><Input type="number" min={0} {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="total_units" render={({ field }) => (
                <FormItem>
                  <FormLabel>Total Units</FormLabel>
                  <FormControl><Input type="number" min={0} {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="estimated_loss_usd" render={({ field }) => (
                <FormItem>
                  <FormLabel>Estimated Loss (USD)</FormLabel>
                  <FormControl><Input type="number" min={0} step="0.01" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="waste_percentage" render={({ field }) => (
                <FormItem>
                  <FormLabel>Waste %</FormLabel>
                  <FormControl><Input type="number" min={0} max={100} step="0.01" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="inspector_name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Inspector Name</FormLabel>
                  <FormControl><Input placeholder="Full name" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="inspection_date" render={({ field }) => (
                <FormItem>
                  <FormLabel>Inspection Date</FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="stuffing_date" render={({ field }) => (
                <FormItem>
                  <FormLabel>Stuffing Date</FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="release_date" render={({ field }) => (
                <FormItem>
                  <FormLabel>Release Date</FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="temperature_log_present" render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0 pt-6">
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                  <FormLabel className="font-normal cursor-pointer">Temperature log present</FormLabel>
                </FormItem>
              )} />
            </div>

            <FormField control={form.control} name="damage_description" render={({ field }) => (
              <FormItem>
                <FormLabel>Damage Description</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder="Describe the nature and extent of the damage in detail…"
                    className="min-h-[100px]"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <div className="flex justify-end">
              <Button type="submit" disabled={isPending}>
                {isPending ? "Saving…" : "Save Damage Report"}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
