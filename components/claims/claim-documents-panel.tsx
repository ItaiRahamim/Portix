import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Paperclip } from "lucide-react";
import { DocumentUploadZone } from "@/components/claims/document-upload-zone";
import type { ChatAttachment } from "@/lib/db";

interface ClaimDocumentsPanelProps {
  claimId: string;
  documents: ChatAttachment[];
}

/**
 * Displays all files attached to any message in this claim thread.
 * Source: portix.claim_attachments (joined through portix.claim_messages).
 *
 * Upload is handled by the Communication (chat) section — files sent via
 * chat are stored in portix.claim_attachments and surface here automatically.
 */
export function ClaimDocumentsPanel({ documents }: ClaimDocumentsPanelProps) {
  const imageDocs = documents.filter((d) => d.media_type === "image");
  const videoDocs = documents.filter((d) => d.media_type === "video");
  const fileDocs  = documents.filter((d) => d.media_type === "document");

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center gap-2">
        <Paperclip className="w-4 h-4 text-gray-400 shrink-0" />
        <CardTitle className="text-base">
          Attachments
          {documents.length > 0 && (
            <span className="ml-2 text-xs font-normal text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">
              {documents.length}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {documents.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">
            No attachments yet. Share files via the Communication section below.
          </p>
        ) : (
          <>
            {imageDocs.length > 0 && (
              <DocumentUploadZone
                label="Images"
                description="Photos and screenshots shared in the claim thread."
                documents={imageDocs}
              />
            )}
            {videoDocs.length > 0 && (
              <DocumentUploadZone
                label="Videos"
                description="Video evidence shared in the claim thread."
                documents={videoDocs}
              />
            )}
            {fileDocs.length > 0 && (
              <DocumentUploadZone
                label="Documents"
                description="PDFs, spreadsheets, and other files shared in the claim thread."
                documents={fileDocs}
              />
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
