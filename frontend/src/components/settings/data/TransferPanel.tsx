import { Download, Upload } from "lucide-react"
import type React from "react"
import { TgButton } from "@/components/ui/tg-button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tg-tooltip"

/** Export / Import header actions for the table-sizes section. */
export const TransferExportImportActions: React.FC<{
  isExporting: boolean
  isImporting: boolean
  selectedExportCount: number
  onExport: () => void
  onImport: (e: React.ChangeEvent<HTMLInputElement>) => void
}> = ({
  isExporting,
  isImporting,
  selectedExportCount,
  onExport,
  onImport,
}) => (
  <>
    <Tooltip>
      <TooltipTrigger asChild>
        <TgButton
          type="button"
          variant="secondary"
          size="md"
          onClick={onExport}
          disabled={selectedExportCount === 0}
          loading={isExporting}
          loadingLabel="Export"
        >
          <Download size={14} />
          Export
        </TgButton>
      </TooltipTrigger>
      <TooltipContent>
        <p className="text-[9px] uppercase font-bold">
          Export selected tables as JSONL
        </p>
      </TooltipContent>
    </Tooltip>
    <div className="relative">
      <input
        type="file"
        accept=".jsonl"
        onChange={onImport}
        className="absolute inset-0 opacity-0 cursor-pointer"
        disabled={isImporting}
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <TgButton
            type="button"
            variant="secondary"
            size="md"
            loading={isImporting}
            loadingLabel="Import"
          >
            <Upload size={14} />
            Import
          </TgButton>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-[9px] uppercase font-bold">
            Import database from JSONL
          </p>
        </TooltipContent>
      </Tooltip>
    </div>
  </>
)
