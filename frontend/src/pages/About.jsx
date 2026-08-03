import React from "react";

export default function About() {
  return (
    <div className="max-w-4xl mx-auto p-8">
      <div className="bg-white rounded-xl shadow border p-10">

        <div className="text-center">

          {/* Logo goes here later */}
          <div className="w-24 h-24 bg-gray-200 rounded-full mx-auto mb-6 flex items-center justify-center text-3xl font-bold">
            F
          </div>

          <h1 className="text-4xl font-bold">
            FABRITRACK
          </h1>

          <p className="text-gray-500 mt-2">
            Garment Manufacturing ERP
          </p>

          <div className="mt-6 text-sm text-gray-600">
            Version 1.0.0
          </div>

        </div>

        <hr className="my-8"/>

        <div className="space-y-4">

          <div>
            <h2 className="font-semibold text-lg">
              About
            </h2>

            <p className="text-gray-600 mt-2">
              FABRITRACK is a complete ERP solution built for garment
              manufacturers to manage fabric purchases, inventory,
              production, warehouse operations, job work, shipments,
              returns, payments, and reporting from a single platform.
            </p>
          </div>

          <div>

            <h2 className="font-semibold text-lg">
              Technologies
            </h2>

            <ul className="list-disc ml-6 mt-2 text-gray-600">
              <li>Frontend : React</li>
              <li>Backend : FastAPI</li>
              <li>Database : PostgreSQL</li>
              <li>Desktop : Tauri</li>
            </ul>

          </div>

          <div>

            <h2 className="font-semibold text-lg">
              Copyright
            </h2>

            <p className="text-gray-600 mt-2">
              © 2026 FABRITRACK
            </p>

            <p className="text-gray-600">
              All Rights Reserved.
            </p>

          </div>

        </div>

      </div>
    </div>
  );
}