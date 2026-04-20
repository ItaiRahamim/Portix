import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import type { LucideIcon } from "lucide-react";

interface KPICardProps {
  label: string;
  value: number | string;
  icon: LucideIcon;
  color?: string;
  iconColor?: string;
}

export function KPICard({ label, value, icon: Icon, color, iconColor }: KPICardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm text-gray-500">{label}</CardTitle>
        <Icon className={`h-4 w-4 ${iconColor || "text-muted-foreground"}`} />
      </CardHeader>
      <CardContent>
        <div className={`text-2xl ${color || ""}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
