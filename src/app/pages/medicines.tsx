import { useState } from "react";
import { Pill, Search, Filter, TrendingUp } from "lucide-react";

const mockMedicines = [
  {
    id: 1,
    name: "Metformin",
    type: "Diabetes",
    usageCount: 45,
    relatedPatients: 42,
    commonDosage: "500mg twice daily",
  },
  {
    id: 2,
    name: "Orlistat",
    type: "Weight Loss",
    usageCount: 89,
    relatedPatients: 78,
    commonDosage: "120mg three times daily",
  },
  {
    id: 3,
    name: "Levothyroxine",
    type: "Thyroid",
    usageCount: 32,
    relatedPatients: 28,
    commonDosage: "50mcg once daily",
  },
  {
    id: 4,
    name: "Phentermine",
    type: "Weight Loss",
    usageCount: 56,
    relatedPatients: 52,
    commonDosage: "37.5mg once daily",
  },
  {
    id: 5,
    name: "Liraglutide",
    type: "Diabetes/Weight Loss",
    usageCount: 34,
    relatedPatients: 31,
    commonDosage: "1.2mg subcutaneous",
  },
  {
    id: 6,
    name: "Atorvastatin",
    type: "Cholesterol",
    usageCount: 67,
    relatedPatients: 59,
    commonDosage: "20mg once daily",
  },
  {
    id: 7,
    name: "Lisinopril",
    type: "Hypertension",
    usageCount: 52,
    relatedPatients: 48,
    commonDosage: "10mg once daily",
  },
  {
    id: 8,
    name: "Semaglutide",
    type: "Diabetes/Weight Loss",
    usageCount: 28,
    relatedPatients: 25,
    commonDosage: "1mg subcutaneous",
  },
  {
    id: 9,
    name: "Topiramate",
    type: "Weight Loss",
    usageCount: 19,
    relatedPatients: 17,
    commonDosage: "50mg twice daily",
  },
  {
    id: 10,
    name: "Megestrol",
    type: "Weight Gain",
    usageCount: 14,
    relatedPatients: 12,
    commonDosage: "400mg once daily",
  },
];

const medicineStats = [
  {
    label: "Total Medicines",
    value: "124",
    icon: Pill,
    color: "bg-primary",
  },
  {
    label: "Weight Loss Meds",
    value: "42",
    icon: TrendingUp,
    color: "bg-blue-500",
  },
  {
    label: "Active Prescriptions",
    value: "189",
    icon: Pill,
    color: "bg-secondary",
  },
  {
    label: "Most Prescribed",
    value: "Orlistat",
    icon: TrendingUp,
    color: "bg-purple-500",
  },
];

export function Medicines() {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState("all");

  const filteredMedicines = mockMedicines.filter((medicine) => {
    const matchesSearch = medicine.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = filterType === "all" || medicine.type.includes(filterType);
    return matchesSearch && matchesFilter;
  });

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-semibold mb-2">Medicine Tracking</h1>
        <p className="text-muted-foreground">Track medications and prescriptions</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-6 mb-6">
        {medicineStats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="bg-card rounded-xl p-6 border border-border shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <div className={`w-12 h-12 rounded-lg ${stat.color} flex items-center justify-center`}>
                  <Icon className="w-6 h-6 text-white" />
                </div>
              </div>
              <div className="text-2xl font-semibold mb-1">{stat.value}</div>
              <div className="text-sm text-muted-foreground">{stat.label}</div>
            </div>
          );
        })}
      </div>

      {/* Filters */}
      <div className="bg-card rounded-xl p-6 border border-border shadow-sm mb-6">
        <div className="flex items-center gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search medicines..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="pl-10 pr-8 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary appearance-none min-w-[200px]"
            >
              <option value="all">All Types</option>
              <option value="Weight Loss">Weight Loss</option>
              <option value="Weight Gain">Weight Gain</option>
              <option value="Diabetes">Diabetes</option>
              <option value="Hypertension">Hypertension</option>
              <option value="Cholesterol">Cholesterol</option>
              <option value="Thyroid">Thyroid</option>
            </select>
          </div>
        </div>
      </div>

      {/* Medicine Table */}
      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-accent border-b border-border">
              <tr>
                <th className="px-6 py-4 text-left font-semibold">Medicine Name</th>
                <th className="px-6 py-4 text-left font-semibold">Type</th>
                <th className="px-6 py-4 text-left font-semibold">Common Dosage</th>
                <th className="px-6 py-4 text-left font-semibold">Usage Count</th>
                <th className="px-6 py-4 text-left font-semibold">Related Patients</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredMedicines.map((medicine) => (
                <tr key={medicine.id} className="hover:bg-accent/50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Pill className="w-5 h-5 text-primary" />
                      </div>
                      <div className="font-medium">{medicine.name}</div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="px-3 py-1 rounded-full text-sm bg-blue-100 text-blue-600">
                      {medicine.type}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-muted-foreground">{medicine.commonDosage}</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className="w-full max-w-[100px] h-2 bg-accent rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary"
                          style={{ width: `${Math.min((medicine.usageCount / 100) * 100, 100)}%` }}
                        />
                      </div>
                      <span className="font-medium">{medicine.usageCount}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-secondary/10 flex items-center justify-center">
                        <span className="text-sm text-secondary">{medicine.relatedPatients}</span>
                      </div>
                      <span className="text-sm text-muted-foreground">patients</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Top Medicines */}
      <div className="mt-6 bg-card rounded-xl p-6 border border-border shadow-sm">
        <h2 className="text-xl font-semibold mb-6">Most Prescribed Medicines</h2>
        <div className="grid grid-cols-3 gap-4">
          {mockMedicines
            .sort((a, b) => b.usageCount - a.usageCount)
            .slice(0, 3)
            .map((medicine, index) => (
              <div
                key={medicine.id}
                className="p-4 rounded-lg border border-border hover:bg-accent transition-colors"
              >
                <div className="flex items-center justify-between mb-3">
                  <span className="text-2xl font-semibold text-primary">#{index + 1}</span>
                  <Pill className="w-6 h-6 text-muted-foreground" />
                </div>
                <div className="font-semibold mb-1">{medicine.name}</div>
                <div className="text-sm text-muted-foreground mb-2">{medicine.type}</div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Prescribed to:</span>
                  <span className="font-medium">{medicine.relatedPatients} patients</span>
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
