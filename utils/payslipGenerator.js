// backend/utils/payslipGenerator.js
import PDFDocument from "pdfkit";
import fetch from "node-fetch";

function formatCurrency(amount) {
  const num = parseFloat(amount);
  if (isNaN(num) || num === null || num === undefined) return "0.00";
  return num.toLocaleString("en-KE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function drawSectionHeader(doc, text, y, x, width, fontSize = 8) {
  doc.font("Helvetica-Bold").fontSize(fontSize).text(text.toUpperCase(), x, y, {
    width: width,
    align: "left",
  });
  const newY = y + doc.currentLineHeight() + 1;
  doc
    .moveTo(x, newY - 2)
    .lineTo(x + width, newY - 2)
    .lineWidth(0.3)
    .strokeColor("#555555")
    .stroke();
  return newY + 3;
}

function drawLineItem(
  doc,
  label,
  value,
  y,
  labelX,
  contentWidth,
  isBold = false,
  fontSize = 7.5,
  valueWidth = 65,
) {
  const valueX = labelX + contentWidth - valueWidth;
  const labelWidthMax = contentWidth - valueWidth - 8;

  doc.font(isBold ? "Helvetica-Bold" : "Helvetica").fontSize(fontSize);
  doc.text(label, labelX, y, {
    width: labelWidthMax,
    align: "left",
    lineBreak: false,
  });

  const actualLabelWidth = doc.widthOfString(label);
  const dotsStartX = labelX + actualLabelWidth + 2;
  const dotsEndX = valueX - 2;
  if (dotsEndX > dotsStartX) {
    let dots = ".".repeat(
      Math.floor((dotsEndX - dotsStartX) / doc.widthOfString(".")),
    );
    doc
      .font("Helvetica")
      .fontSize(fontSize)
      .fillColor("#c0c0c0")
      .text(dots, dotsStartX, y, {
        width: dotsEndX - dotsStartX,
        align: "left",
        lineBreak: false,
      })
      .fillColor("black");
  }

  doc
    .font(isBold ? "Helvetica-Bold" : "Helvetica")
    .fontSize(fontSize)
    .text(String(value), valueX, y, { width: valueWidth, align: "right" });

  return y + doc.currentLineHeight() + 1;
}

// Function to draw a single payslip with the original style
async function drawSinglePayslip(
  doc,
  detail,
  formattedPayrollMonth,
  companyDetails,
  employeeData,
  xOffset,
  yOffset,
  width,
  height,
  isFirstCopy = true,
) {
  const margin = 15;
  const contentWidth = width - margin * 2;
  let currentY = yOffset + margin;
  let currentX = xOffset + margin;

  const companyName = companyDetails?.business_name || "YOUR COMPANY";
  const employeeFullName =
    `${employeeData.first_name || ""} ${employeeData.other_names || ""} ${employeeData.last_name || ""}`.trim();
  const personal_relief = 2400.0;
  const gross_tax = detail.paye_tax + personal_relief || 0.0;
  const allowable_deductions =
    detail.total_statutory_deductions - detail.paye_tax || 0.0;

  // --- Logo (top-right) ---
  let logoHeight = 0;
  let logoX = currentX;
  let logoY = currentY;
  if (companyDetails?.logo_url) {
    try {
      // Fetch logo once and cache it
      if (!global._cachedLogo) {
        const logoResponse = await fetch(companyDetails.logo_url);
        if (logoResponse.ok) {
          global._cachedLogo = await logoResponse.buffer();
        }
      }

      if (global._cachedLogo) {
        const logoWidth = 40; // Smaller size for A5
        logoX = currentX + contentWidth - logoWidth;
        logoY = currentY;
        doc.image(global._cachedLogo, logoX, logoY, { width: logoWidth });
        logoHeight = 40;
      }
    } catch (e) {
      console.error("Logo fetch error:", e);
    }
  }

 // --- Header ---
// Calculate header height to account for logo
const headerStartY = currentY;
doc
  .font("Helvetica-Bold")
  .fontSize(11)
  .text(companyName.toUpperCase(), currentX, currentY, {
    width: contentWidth,
    align: "center",
  });
currentY += doc.currentLineHeight() * 1.1;
doc.font("Helvetica-Bold").fontSize(9.5).text("PAYSLIP", currentX, currentY, {
  width: contentWidth,
  align: "center",
});
currentY += doc.currentLineHeight() * 0.8;

// Printed on - position it below the logo
const printedOnY = Math.max(currentY, logoY + logoHeight + 2);
doc
  .font("Helvetica")
  .fontSize(6.5)
  .text(
    `PRINTED ON ${new Date().toLocaleDateString("en-GB").toUpperCase()}`,
    currentX,
    printedOnY,
    {
      width: contentWidth,
      align: "right",
    },
  );
currentY = printedOnY + doc.currentLineHeight() * 1.5;

  // --- Employee Details ---
  const empLineHeight = 9;
  const empLabelWidth = 70;
  const empDetails = [
    { label: "EMPLOYEE NO:", value: employeeData.employee_number || "-" },
    { label: "NAME:", value: employeeFullName },
    { label: "KRA PIN:", value: employeeData.krapin || "-" },
    { label: "NSSF NO:", value: employeeData.nssf_number || "-" },
    { label: "SHIF NO:", value: employeeData.shif_number || "-" },
    { label: "PERIOD:", value: formattedPayrollMonth.toUpperCase() },
  ];

  // Single column, left aligned
  empDetails.forEach((item) => {
    doc.font("Helvetica-Bold").fontSize(7).text(item.label, currentX, currentY);
    doc
      .font("Helvetica")
      .fontSize(7)
      .text(item.value, currentX + empLabelWidth, currentY);
    currentY += empLineHeight;
  });

  currentY += 4; // Small space after employee details

  // --- EARNINGS ---
  currentY = drawSectionHeader(
    doc,
    "EARNINGS",
    currentY,
    currentX,
    contentWidth,
    7.5,
  );
  currentY = drawLineItem(
    doc,
    "Basic Pay",
    formatCurrency(detail.basic_salary),
    currentY,
    currentX,
    contentWidth,
    false,
    7,
    55,
  );

  if (detail.allowances_details) {
    try {
      const allowances = Array.isArray(detail.allowances_details)
        ? detail.allowances_details
        : JSON.parse(detail.allowances_details);

      allowances.forEach((allowance) => {
        if (parseFloat(allowance.value) > 0) {
          currentY = drawLineItem(
            doc,
            allowance.name,
            formatCurrency(allowance.value),
            currentY,
            currentX,
            contentWidth,
            false,
            7,
            55,
          );
        }
      });
    } catch (err) {
      console.error("Invalid allowances_details JSON", err);
    }
  }

  currentY = drawLineItem(
    doc,
    "GROSS PAY",
    formatCurrency(detail.gross_pay),
    currentY,
    currentX,
    contentWidth,
    true,
    7.5,
    55,
  );
  currentY += 4;

  // --- TAXATION ---
  currentY = drawSectionHeader(
    doc,
    "TAXATION",
    currentY,
    currentX,
    contentWidth,
    7.5,
  );

  const isSecondary =
    employeeData.employee_type?.toLowerCase() === "secondary employee";
  const penReliefValue = isSecondary
    ? "0.00"
    : formatCurrency(detail.nssf_deduction);
  if (detail.nssf_deduction || isSecondary) {
    currentY = drawLineItem(
      doc,
      "PEN. Relief (INCL. NSSF)",
      penReliefValue,
      currentY,
      currentX,
      contentWidth,
      false,
      7,
      55,
    );
  }

  if (detail.taxable_income) {
    currentY = drawLineItem(
      doc,
      "Taxable Pay",
      formatCurrency(detail.taxable_income),
      currentY,
      currentX,
      contentWidth,
      true,
      7,
      55,
    );
  }

  const allowableValue = isSecondary
    ? "0.00"
    : formatCurrency(allowable_deductions);
  if (allowable_deductions || isSecondary) {
    currentY = drawLineItem(
      doc,
      "Allowable Deductions",
      allowableValue,
      currentY,
      currentX,
      contentWidth,
      false,
      7,
      55,
    );
  }

  const grossTaxValue = isSecondary
    ? formatCurrency(detail.paye_tax || 0)
    : formatCurrency(gross_tax);
  if (gross_tax || isSecondary) {
    currentY = drawLineItem(
      doc,
      "Gross Tax",
      grossTaxValue,
      currentY,
      currentX,
      contentWidth,
      false,
      7,
      55,
    );
  }

  if (!isSecondary && personal_relief) {
    currentY = drawLineItem(
      doc,
      "Monthly Personal Relief",
      formatCurrency(personal_relief),
      currentY,
      currentX,
      contentWidth,
      false,
      7,
      55,
    );
  }

  if (!isSecondary && detail.insurance_relief) {
    currentY = drawLineItem(
      doc,
      "Insurance Relief",
      formatCurrency(detail.insurance_relief),
      currentY,
      currentX,
      contentWidth,
      false,
      7,
      55,
    );
  }

  currentY += 4;

  // --- DEDUCTIONS ---
  currentY = drawSectionHeader(
    doc,
    "DEDUCTIONS",
    currentY,
    currentX,
    contentWidth,
    7.5,
  );
  currentY = drawLineItem(
    doc,
    "PAYE",
    formatCurrency(detail.paye_tax),
    currentY,
    currentX,
    contentWidth,
    false,
    7,
    55,
  );
  if (parseFloat(detail.nssf_tier1_deduction) > 0) {
    currentY = drawLineItem(
      doc,
      "NSSF Tier I",
      formatCurrency(detail.nssf_tier1_deduction),
      currentY,
      currentX,
      contentWidth,
      false,
      7,
      55,
    );
  }
  if (parseFloat(detail.nssf_tier2_deduction) > 0) {
    currentY = drawLineItem(
      doc,
      "NSSF Tier II",
      formatCurrency(detail.nssf_tier2_deduction),
      currentY,
      currentX,
      contentWidth,
      false,
      7,
      55,
    );
  }
  currentY = drawLineItem(
    doc,
    "SHIF",
    formatCurrency(detail.shif_deduction),
    currentY,
    currentX,
    contentWidth,
    false,
    7,
    55,
  );
  currentY = drawLineItem(
    doc,
    "Housing Levy",
    formatCurrency(detail.housing_levy_deduction),
    currentY,
    currentX,
    contentWidth,
    false,
    7,
    55,
  );
  if (parseFloat(detail.helb_deduction) > 0) {
    currentY = drawLineItem(
      doc,
      "Student Loan(HELB)",
      formatCurrency(detail.helb_deduction),
      currentY,
      currentX,
      contentWidth,
      false,
      7,
      55,
    );
  }

  if (detail.deductions_details) {
    try {
      const deductions = Array.isArray(detail.deductions_details)
        ? detail.deductions_details
        : JSON.parse(detail.deductions_details);

      deductions.forEach((deduction) => {
        if (parseFloat(deduction.value) > 0) {
          currentY = drawLineItem(
            doc,
            deduction.name,
            formatCurrency(deduction.value),
            currentY,
            currentX,
            contentWidth,
            false,
            7,
            55,
          );
        }
      });
    } catch (err) {
      console.error("Invalid deductions_details JSON", err);
    }
  }

  currentY = drawLineItem(
    doc,
    "TOTAL DEDUCTIONS",
    formatCurrency(detail.total_deductions),
    currentY,
    currentX,
    contentWidth,
    true,
    7.5,
    55,
  );
  currentY += 4;

  // --- NET PAY ---
  currentY = drawLineItem(
    doc,
    "NET PAY",
    formatCurrency(detail.net_pay),
    currentY,
    currentX,
    contentWidth,
    true,
    8.5,
    55,
  );
  currentY += 6;

  // --- PAYMENT DETAILS ---
  currentY = drawSectionHeader(
    doc,
    "PAYMENT DETAILS",
    currentY,
    currentX,
    contentWidth,
    6.5,
  );
  doc.font("Helvetica").fontSize(7).text("Pay Mode:", currentX, currentY);
  doc
    .font("Helvetica-Bold")
    .fontSize(7)
    .text(
      (detail.payment_method || "-").toUpperCase(),
      currentX + 60,
      currentY,
    );
  currentY += empLineHeight * 0.7;

  if (detail.payment_method?.toLowerCase().includes("bank")) {
    doc
      .font("Helvetica")
      .fontSize(7)
      .text("Bank / Acc No:", currentX, currentY);
    doc
      .font("Helvetica")
      .fontSize(7)
      .text(
        `${detail.bank_name || "-"} / ${detail.account_name || "-"}`,
        currentX + 60,
        currentY,
      );
  } else if (detail.payment_method?.toLowerCase().includes("mpesa")) {
    doc.font("Helvetica").fontSize(7).text("M-Pesa No:", currentX, currentY);
    doc
      .font("Helvetica")
      .fontSize(7)
      .text(detail.mpesa_phone || "-", currentX + 60, currentY);
  }

  // Add a subtle border around the payslip
  doc
    .rect(xOffset, yOffset, width, height)
    .lineWidth(0.5)
    .strokeColor("#dddddd")
    .stroke();

  // Add cut line indicator in the middle (vertical dashed line) - only for first copy
  if (isFirstCopy) {
    const cutX = xOffset + width;
    doc
      .moveTo(cutX, yOffset)
      .lineTo(cutX, yOffset + height)
      .lineWidth(0.5)
      .dash(3, { space: 3 })
      .strokeColor("#999999")
      .stroke();
    doc.undash();

    // Add "CUT" text near the cut line
    doc
      .font("Helvetica")
      .fontSize(5)
      .fillColor("#999999")
      .text("CUT", cutX + 1, yOffset + height / 2 - 3, {
        width: 10,
        align: "left",
      })
      .fillColor("black");
  }

  return currentY;
}

// export async function generatePayslipPDF(
//   detail,
//   formattedPayrollMonth,
//   companyDetails,
//   employeeData,
// ) {
//   return new Promise(async (resolve, reject) => {
//     // Use A5 Landscape for two payslips
//     const doc = new PDFDocument({
//       size: "A5",
//       layout: "landscape",
//       margins: { top: 12, bottom: 12, left: 12, right: 12 },
//     });

//     const buffers = [];
//     doc.on("data", buffers.push.bind(buffers));
//     doc.on("end", () => resolve(Buffer.concat(buffers)));
//     doc.on("error", reject);

//     const pageWidth = doc.page.width;
//     const pageHeight = doc.page.height;
//     const margin = 8;

//     // Calculate dimensions for two payslips side by side
//     const halfWidth = (pageWidth - margin * 3) / 2;
//     const payslipHeight = pageHeight - margin * 2;

//     // Draw left payslip (Employee Copy)
//     await drawSinglePayslip(
//       doc,
//       detail,
//       formattedPayrollMonth,
//       companyDetails,
//       employeeData,
//       margin,
//       margin,
//       halfWidth,
//       payslipHeight,
//       true,
//     );

//     // Draw right payslip (Company Copy)
//     await drawSinglePayslip(
//       doc,
//       detail,
//       formattedPayrollMonth,
//       companyDetails,
//       employeeData,
//       margin + halfWidth + margin,
//       margin,
//       halfWidth,
//       payslipHeight,
//       false,
//     );

//     doc.end();
//   });
// }

// Keep the original function for backward compatibility
export async function generatePayslipPDFSingle(
  detail,
  formattedPayrollMonth,
  companyDetails,
  employeeData,
) {
  return new Promise(async (resolve, reject) => {
    const doc = new PDFDocument({
      size: "A5",
      margins: { top: 25, bottom: 25, left: 28, right: 28 },
    });

    const buffers = [];
    doc.on("data", buffers.push.bind(buffers));
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.on("error", reject);

    const companyName = companyDetails?.business_name || "YOUR COMPANY";
    const employeeFullName =
      `${employeeData.first_name || ""} ${employeeData.other_names || ""} ${employeeData.last_name || ""}`.trim();
    const personal_relief = 2400.0;
    const gross_tax = detail.paye_tax + personal_relief || 0.0;
    const allowable_deductions =
      detail.total_statutory_deductions - detail.paye_tax || 0.0;

    const margin = doc.page.margins.left;
    const contentWidth = doc.page.width - margin * 2;
    let currentY = doc.page.margins.top;

    // --- Logo (top-right) ---
    let logoHeight = 0;
    if (companyDetails?.logo_url) {
      try {
        const logoResponse = await fetch(companyDetails.logo_url);
        if (logoResponse.ok) {
          const logoBuffer = await logoResponse.buffer();
          const logoWidth = 50;
          const logoX = doc.page.width - doc.page.margins.right - logoWidth;
          const logoY = currentY;
          doc.image(logoBuffer, logoX, logoY, { width: logoWidth });
          logoHeight = 50;
        }
      } catch (e) {
        console.error("Logo fetch error:", e);
      }
    }

    // --- Header ---
    doc
      .font("Helvetica-Bold")
      .fontSize(13)
      .text(companyName.toUpperCase(), 0, currentY, { align: "center" });
    currentY += doc.currentLineHeight() * 1.1;
    doc
      .font("Helvetica-Bold")
      .fontSize(11)
      .text("PAYSLIP", { align: "center" });
    currentY += doc.currentLineHeight() * 0.8;

    const printedY = Math.max(currentY, logoHeight + doc.page.margins.top + 5);
    doc
      .font("Helvetica")
      .fontSize(7)
      .text(
        `PRINTED ON ${new Date().toLocaleDateString("en-GB").toUpperCase()}`,
        0,
        printedY,
        { align: "right" },
      );

    currentY = printedY + doc.currentLineHeight() * 1.8;

    // --- Employee Details ---
    const empLineHeight = 10;
    const empLabelWidth = 80;
    const empDetails = [
      { label: "EMPLOYEE NO:", value: employeeData.employee_number || "-" },
      { label: "NAME:", value: employeeFullName },
      { label: "KRA PIN:", value: employeeData.krapin || "-" },
      { label: "NSSF NO:", value: employeeData.nssf_number || "-" },
      { label: "SHIF NO:", value: employeeData.shif_number || "-" },
      { label: "PERIOD:", value: formattedPayrollMonth.toUpperCase() },
    ];
    empDetails.forEach((item) => {
      doc
        .font("Helvetica-Bold")
        .fontSize(7.5)
        .text(item.label, margin, currentY);
      doc
        .font("Helvetica")
        .fontSize(7.5)
        .text(item.value, margin + empLabelWidth, currentY);
      currentY += empLineHeight;
    });
    currentY += empLineHeight * 0.8;

    // --- EARNINGS ---
    currentY = drawSectionHeader(
      doc,
      "EARNINGS",
      currentY,
      margin,
      contentWidth,
      8,
    );
    currentY = drawLineItem(
      doc,
      "Basic Pay",
      formatCurrency(detail.basic_salary),
      currentY,
      margin,
      contentWidth,
      false,
      7.5,
      80,
    );

    if (detail.allowances_details) {
      try {
        const allowances = Array.isArray(detail.allowances_details)
          ? detail.allowances_details
          : JSON.parse(detail.allowances_details);

        allowances.forEach((allowance) => {
          if (parseFloat(allowance.value) > 0) {
            currentY = drawLineItem(
              doc,
              allowance.name,
              formatCurrency(allowance.value),
              currentY,
              margin,
              contentWidth,
              false,
              7.5,
              80,
            );
          }
        });
      } catch (err) {
        console.error("Invalid allowances_details JSON", err);
      }
    }

    currentY = drawLineItem(
      doc,
      "GROSS PAY",
      formatCurrency(detail.gross_pay),
      currentY,
      margin,
      contentWidth,
      true,
      8,
      80,
    );
    currentY += empLineHeight * 1.2;

    // --- TAXATION ---
    currentY = drawSectionHeader(
      doc,
      "TAXATION",
      currentY,
      margin,
      contentWidth,
      8,
    );

    const isSecondary =
      employeeData.employee_type?.toLowerCase() === "secondary employee";
    const penReliefValue = isSecondary
      ? "0.00"
      : formatCurrency(detail.nssf_deduction);
    if (detail.nssf_deduction || isSecondary) {
      currentY = drawLineItem(
        doc,
        "PEN. Relief (INCL. NSSF)",
        penReliefValue,
        currentY,
        margin,
        contentWidth,
        false,
        7.5,
        80,
      );
    }

    if (detail.taxable_income) {
      currentY = drawLineItem(
        doc,
        "Taxable Pay",
        formatCurrency(detail.taxable_income),
        currentY,
        margin,
        contentWidth,
        true,
        7.5,
        80,
      );
    }

    const allowableValue = isSecondary
      ? "0.00"
      : formatCurrency(allowable_deductions);
    if (allowable_deductions || isSecondary) {
      currentY = drawLineItem(
        doc,
        "Allowable Deductions",
        allowableValue,
        currentY,
        margin,
        contentWidth,
        false,
        7.5,
        80,
      );
    }

    const grossTaxValue = isSecondary
      ? formatCurrency(detail.paye_tax || 0)
      : formatCurrency(gross_tax);
    if (gross_tax || isSecondary) {
      currentY = drawLineItem(
        doc,
        "Gross Tax",
        grossTaxValue,
        currentY,
        margin,
        contentWidth,
        false,
        7.5,
        80,
      );
    }

    if (!isSecondary && personal_relief) {
      currentY = drawLineItem(
        doc,
        "Monthly Personal Relief",
        formatCurrency(personal_relief),
        currentY,
        margin,
        contentWidth,
        false,
        7.5,
        80,
      );
    }

    if (!isSecondary && detail.insurance_relief) {
      currentY = drawLineItem(
        doc,
        "Insurance Relief",
        formatCurrency(detail.insurance_relief),
        currentY,
        margin,
        contentWidth,
        false,
        7.5,
        80,
      );
    }

    currentY += empLineHeight * 1.2;

    // --- DEDUCTIONS ---
    currentY = drawSectionHeader(
      doc,
      "DEDUCTIONS",
      currentY,
      margin,
      contentWidth,
      8,
    );
    currentY = drawLineItem(
      doc,
      "PAYE",
      formatCurrency(detail.paye_tax),
      currentY,
      margin,
      contentWidth,
      false,
      7.5,
      80,
    );
    if (parseFloat(detail.nssf_tier1_deduction) > 0) {
      currentY = drawLineItem(
        doc,
        "NSSF Tier I",
        formatCurrency(detail.nssf_tier1_deduction),
        currentY,
        margin,
        contentWidth,
        false,
        7.5,
        80,
      );
    }
    if (parseFloat(detail.nssf_tier2_deduction) > 0) {
      currentY = drawLineItem(
        doc,
        "NSSF Tier II",
        formatCurrency(detail.nssf_tier2_deduction),
        currentY,
        margin,
        contentWidth,
        false,
        7.5,
        80,
      );
    }
    currentY = drawLineItem(
      doc,
      "SHIF",
      formatCurrency(detail.shif_deduction),
      currentY,
      margin,
      contentWidth,
      false,
      7.5,
      80,
    );
    currentY = drawLineItem(
      doc,
      "Housing Levy",
      formatCurrency(detail.housing_levy_deduction),
      currentY,
      margin,
      contentWidth,
      false,
      7.5,
      80,
    );
    if (parseFloat(detail.helb_deduction) > 0) {
      currentY = drawLineItem(
        doc,
        "Student Loan(HELB)",
        formatCurrency(detail.helb_deduction),
        currentY,
        margin,
        contentWidth,
        false,
        7.5,
        80,
      );
    }

    if (detail.deductions_details) {
      try {
        const deductions = Array.isArray(detail.deductions_details)
          ? detail.deductions_details
          : JSON.parse(detail.deductions_details);

        deductions.forEach((deduction) => {
          if (parseFloat(deduction.value) > 0) {
            currentY = drawLineItem(
              doc,
              deduction.name,
              formatCurrency(deduction.value),
              currentY,
              margin,
              contentWidth,
              false,
              7.5,
              80,
            );
          }
        });
      } catch (err) {
        console.error("Invalid deductions_details JSON", err);
      }
    }

    currentY = drawLineItem(
      doc,
      "TOTAL DEDUCTIONS",
      formatCurrency(detail.total_deductions),
      currentY,
      margin,
      contentWidth,
      true,
      8,
      80,
    );
    currentY += empLineHeight * 1.2;

    // --- NET PAY ---
    currentY = drawLineItem(
      doc,
      "NET PAY",
      formatCurrency(detail.net_pay),
      currentY,
      margin,
      contentWidth,
      true,
      9.5,
      80,
    );
    currentY += empLineHeight * 2;

    // --- PAYMENT DETAILS ---
    currentY = drawSectionHeader(
      doc,
      "PAYMENT DETAILS",
      currentY,
      margin,
      contentWidth,
      7.5,
    );
    doc.font("Helvetica").fontSize(8).text("Pay Mode:", margin, currentY);
    doc
      .font("Helvetica-Bold")
      .fontSize(8)
      .text(
        (detail.payment_method || "-").toUpperCase(),
        margin + 70,
        currentY,
      );
    currentY += empLineHeight;

    if (detail.payment_method?.toLowerCase().includes("bank")) {
      doc
        .font("Helvetica")
        .fontSize(8)
        .text("Bank / Acc No:", margin, currentY);
      doc
        .font("Helvetica")
        .fontSize(8)
        .text(
          `${detail.bank_name || "-"} / ${detail.account_name || "-"}`,
          margin + 70,
          currentY,
        );
    } else if (detail.payment_method?.toLowerCase().includes("mpesa")) {
      doc.font("Helvetica").fontSize(8).text("M-Pesa No:", margin, currentY);
      doc
        .font("Helvetica")
        .fontSize(8)
        .text(detail.mpesa_phone || "-", margin + 70, currentY);
    }

    doc.end();
  });
}

// Enhanced function to generate multiple payslips with different layouts
export async function generateMultiplePayslipsPDF(payslipDataArray, layout = 'single', duplicate = false) {
  return new Promise(async (resolve, reject) => {
    let doc;
    let pageWidth, pageHeight;
    const margin = 10;

    // Determine page size and layout
    if (layout === 'single') {
      // For single employee, use A5 Portrait
      doc = new PDFDocument({
        size: 'A5',
        margins: { top: 15, bottom: 15, left: 20, right: 20 }
      });
      pageWidth = doc.page.width;
      pageHeight = doc.page.height;
    } else if (layout === 'two-up' || layout === 'duplicate') {
      // For duplicate or two-up, use A4 Landscape
      doc = new PDFDocument({
        size: 'A4',
        layout: 'landscape',
        margins: { top: 12, bottom: 12, left: 12, right: 12 }
      });
      pageWidth = doc.page.width;
      pageHeight = doc.page.height;
    } else if (layout === 'grid') {
      // For grid layout (2x2), use A4 Portrait
      doc = new PDFDocument({
        size: 'A4',
        margins: { top: 12, bottom: 12, left: 12, right: 12 }
      });
      pageWidth = doc.page.width;
      pageHeight = doc.page.height;
    }

    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    if (layout === 'single') {
      // One payslip per page (single copy)
      for (let i = 0; i < payslipDataArray.length; i++) {
        if (i > 0) doc.addPage();
        const { detail, employee, company, formattedPeriod } = payslipDataArray[i];
        await drawSinglePayslip(
          doc, 
          detail, 
          formattedPeriod, 
          company, 
          employee, 
          margin, 
          margin, 
          pageWidth - margin * 2, 
          pageHeight - margin * 2,
          true
        );
      }
    } else if (layout === 'duplicate') {
      // Each employee gets their own page with duplicate copies
      for (let i = 0; i < payslipDataArray.length; i++) {
        if (i > 0) doc.addPage();
        const { detail, employee, company, formattedPeriod } = payslipDataArray[i];
        
        // Use A5 style layout for duplicate (two copies side by side on A4 landscape)
        // We need to adjust the page size for duplicate layout if we want A4 landscape
        // But since we want each employee on their own page with duplicate, we'll use the existing logic
        
        // Draw two copies on the same page
        const halfWidth = (pageWidth - margin * 3) / 2;
        const payslipHeight = pageHeight - margin * 2;
        
        // First copy (Employee Copy)
        await drawSinglePayslip(
          doc,
          detail,
          formattedPeriod,
          company,
          employee,
          margin,
          margin,
          halfWidth,
          payslipHeight,
          true
        );
        
        // Second copy (Company Copy)
        await drawSinglePayslip(
          doc,
          detail,
          formattedPeriod,
          company,
          employee,
          margin + halfWidth + margin,
          margin,
          halfWidth,
          payslipHeight,
          false
        );
      }
    } else if (layout === 'two-up') {
      // Two different employees side by side on A4 Landscape
      const halfWidth = (pageWidth - margin * 3) / 2;
      const payslipHeight = pageHeight - margin * 2;

      for (let i = 0; i < payslipDataArray.length; i += 2) {
        if (i > 0) doc.addPage();
        
        // First payslip (left)
        const data1 = payslipDataArray[i];
        if (data1) {
          await drawSinglePayslip(
            doc, 
            data1.detail, 
            data1.formattedPeriod, 
            data1.company, 
            data1.employee,
            margin, 
            margin, 
            halfWidth, 
            payslipHeight,
            true
          );
        }

        // Second payslip (right)
        const data2 = payslipDataArray[i + 1];
        if (data2) {
          await drawSinglePayslip(
            doc,
            data2.detail,
            data2.formattedPeriod,
            data2.company,
            data2.employee,
            margin + halfWidth + margin,
            margin,
            halfWidth,
            payslipHeight,
            false
          );
        }
      }
    } else if (layout === 'grid') {
      // Grid layout: 2x2 on A4 Portrait (mostly for preview)
      const cols = 2;
      const rows = 2;
      const payslipWidth = (pageWidth - margin * (cols + 1)) / cols;
      const payslipHeight = (pageHeight - margin * (rows + 1)) / rows;

      for (let i = 0; i < payslipDataArray.length; i += cols * rows) {
        if (i > 0) doc.addPage();

        let idx = 0;
        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            const dataIndex = i + idx;
            if (dataIndex < payslipDataArray.length) {
              const data = payslipDataArray[dataIndex];
              const x = margin + col * (payslipWidth + margin);
              const y = margin + row * (payslipHeight + margin);
              await drawSinglePayslip(
                doc,
                data.detail,
                data.formattedPeriod,
                data.company,
                data.employee,
                x,
                y,
                payslipWidth,
                payslipHeight,
                true
              );
            }
            idx++;
          }
        }
      }
    }

    doc.end();
  });
}

// Keep the existing generatePayslipPDF function for single payslip
export async function generatePayslipPDF(detail, formattedPayrollMonth, companyDetails, employeeData) {
  return new Promise(async (resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A5',
      margins: { top: 25, bottom: 25, left: 28, right: 28 }
    });

    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const margin = doc.page.margins.left;
    const contentWidth = doc.page.width - margin * 2;
    let currentY = doc.page.margins.top;

    // ... (rest of the single payslip generation code remains the same as before)

    // Call the existing drawSinglePayslip function
    await drawSinglePayslip(
      doc,
      detail,
      formattedPayrollMonth,
      companyDetails,
      employeeData,
      margin,
      currentY,
      contentWidth,
      doc.page.height - margin * 2
    );

    doc.end();
  });
}