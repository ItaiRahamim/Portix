import { useState } from "react";
import { useParams, useNavigate } from "react-router";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { ArrowLeft, Send, Upload, Image, Video, FileText, User } from "lucide-react";
import { DashboardLayout } from "../components/DashboardLayout";
import { getClaim, type ClaimStatus } from "../data/mockData";
import { toast } from "sonner";

export function ClaimDetailPage() {
  const { claimId } = useParams();
  const navigate = useNavigate();
  const [newMessage, setNewMessage] = useState("");

  const claim = getClaim(claimId || "");

  if (!claim) {
    return (
      <DashboardLayout role="importer" title="Claim Not Found" subtitle="">
        <div className="text-center py-20">
          <p className="text-gray-500">Claim not found.</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate(-1)}>Go Back</Button>
        </div>
      </DashboardLayout>
    );
  }

  const claimStatusStyles: Record<ClaimStatus, string> = {
    open: "bg-blue-100 text-blue-700",
    "under-review": "bg-yellow-100 text-yellow-700",
    negotiation: "bg-orange-100 text-orange-700",
    resolved: "bg-green-100 text-green-700",
    closed: "bg-gray-200 text-gray-700",
  };

  const claimStatusLabels: Record<ClaimStatus, string> = {
    open: "Open",
    "under-review": "Under Review",
    negotiation: "Negotiation",
    resolved: "Resolved",
    closed: "Closed",
  };

  const handleSend = () => {
    if (!newMessage.trim()) return;
    toast.success("Message sent.");
    setNewMessage("");
  };

  return (
    <DashboardLayout
      role="importer"
      title={`Claim: ${claim.containerNumber}`}
      subtitle={`${claim.supplierName} - ${claim.productName}`}
    >
      <Button variant="ghost" size="sm" className="mb-4 gap-1.5" onClick={() => navigate("/importer/claims")}>
        <ArrowLeft className="w-4 h-4" />Back to Claims
      </Button>

      {/* Claim Info */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-gray-500 text-xs">Container</p>
              <p className="mt-0.5">{claim.containerNumber}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">Supplier</p>
              <p className="mt-0.5">{claim.supplierName}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">Product</p>
              <p className="mt-0.5">{claim.productName}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">Claim Type</p>
              <p className="mt-0.5 capitalize">{claim.claimType}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">Claim Amount</p>
              <p className="mt-0.5">${claim.amount.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-gray-500 text-xs">Status</p>
              <span className={`text-xs px-2 py-0.5 rounded ${claimStatusStyles[claim.status]}`}>
                {claimStatusLabels[claim.status]}
              </span>
            </div>
            <div className="md:col-span-2">
              <p className="text-gray-500 text-xs">Description</p>
              <p className="mt-0.5 text-sm">{claim.description}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Message Thread */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Conversation</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4 mb-6 max-h-[400px] overflow-y-auto">
            {claim.messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-3 ${msg.senderRole === "importer" ? "" : "flex-row-reverse"}`}
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                  msg.senderRole === "importer" ? "bg-blue-100" : "bg-green-100"
                }`}>
                  <User className={`w-4 h-4 ${msg.senderRole === "importer" ? "text-blue-600" : "text-green-600"}`} />
                </div>
                <div className={`max-w-[70%] ${msg.senderRole === "importer" ? "" : "text-right"}`}>
                  <p className="text-xs text-gray-500 mb-1">
                    {msg.sender} &middot; {msg.timestamp}
                  </p>
                  <div className={`rounded-lg p-3 text-sm ${
                    msg.senderRole === "importer"
                      ? "bg-blue-50 text-gray-900"
                      : "bg-green-50 text-gray-900"
                  }`}>
                    {msg.text}
                  </div>
                  {msg.attachments && msg.attachments.length > 0 && (
                    <div className="flex gap-2 mt-2 flex-wrap">
                      {msg.attachments.map((att, i) => (
                        <span key={i} className="text-xs px-2 py-1 rounded bg-gray-100 flex items-center gap-1">
                          {att.type === "image" && <Image className="w-3 h-3" />}
                          {att.type === "video" && <Video className="w-3 h-3" />}
                          {att.type === "document" && <FileText className="w-3 h-3" />}
                          {att.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Reply */}
          <div className="border-t pt-4">
            <div className="flex gap-2">
              <Textarea
                placeholder="Type your message..."
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                rows={2}
                className="flex-1"
              />
              <div className="flex flex-col gap-1">
                <Button size="sm" onClick={handleSend} className="gap-1">
                  <Send className="w-4 h-4" />
                  Send
                </Button>
                <label>
                  <Button variant="outline" size="sm" className="gap-1 w-full" asChild>
                    <span>
                      <Upload className="w-3.5 h-3.5" />
                      Attach
                    </span>
                  </Button>
                  <input type="file" className="hidden" accept=".pdf,.jpg,.png,.mp4,.doc" multiple
                    onChange={() => toast.success("File attached.")}
                  />
                </label>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </DashboardLayout>
  );
}
