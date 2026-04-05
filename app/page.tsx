"use client";

import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Package, FileCheck, ShieldCheck, Ship } from "lucide-react";

const roles = [
  {
    title: "Importer",
    description: "Monitor containers, track documents, manage accounts, claims, and import licenses",
    icon: Package,
    path: "/importer",
    color: "bg-blue-600",
    screens: ["Container Control", "Container Details", "Accounts", "Claims", "Licenses"],
  },
  {
    title: "Supplier",
    description: "Upload required documents, manage cargo photos, replace rejected files, and track accounts",
    icon: FileCheck,
    path: "/supplier",
    color: "bg-green-600",
    screens: ["Container Overview", "Container Details", "Cargo Photos", "Accounts"],
  },
  {
    title: "Customs Agent",
    description: "Review, approve, or reject import documents and manage clearance readiness per container",
    icon: ShieldCheck,
    path: "/customs-agent",
    color: "bg-purple-600",
    screens: ["Container Review Queue", "Container Details", "Accounts"],
  },
];

export default function LandingPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b">
        <div className="container mx-auto px-4 py-6 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gray-900 flex items-center justify-center">
            <Ship className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl text-gray-900">Portix</h1>
            <p className="text-gray-500 text-sm">Import/Export Logistics Management Platform</p>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-12">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl text-gray-900 mb-3">Select Your Role</h2>
            <p className="text-gray-500">Choose your role to access the appropriate dashboard</p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {roles.map((role) => {
              const Icon = role.icon;
              return (
                <Card
                  key={role.path}
                  className="hover:shadow-lg transition-shadow cursor-pointer"
                  onClick={() => router.push(role.path)}
                >
                  <CardHeader>
                    <div className={`w-12 h-12 rounded-lg ${role.color} flex items-center justify-center mb-4`}>
                      <Icon className="w-6 h-6 text-white" />
                    </div>
                    <CardTitle>{role.title}</CardTitle>
                    <CardDescription>{role.description}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="mb-4">
                      <p className="text-xs text-gray-400 mb-2">Available screens:</p>
                      <div className="flex flex-wrap gap-1">
                        {role.screens.map((s) => (
                          <span key={s} className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                            {s}
                          </span>
                        ))}
                      </div>
                    </div>
                    <Button className="w-full" variant="outline">
                      Access Dashboard
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </main>
    </div>
  );
}
