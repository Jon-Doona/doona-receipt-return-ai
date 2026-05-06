#!/usr/bin/env python3
"""Quick script to analyze Excel structure"""
import json

# Since openpyxl may not be available, we'll extract the ZIP and read XML
import zipfile
import xml.etree.ElementTree as ET

xlsx_path = "AI Doona Trip Expense Tool Template ______ 2026.xlsx"

try:
    # Read workbook structure
    with zipfile.ZipFile(xlsx_path, 'r') as zip_ref:
        # Get sheet names
        with zip_ref.open('xl/workbook.xml') as f:
            root = ET.fromstring(f.read())
            ns = {'': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
            sheets = []
            for sheet in root.findall('.//sheet', ns) or root.findall('.//{http://schemas.openxmlformats.org/spreadsheetml/2006/main}sheet'):
                sheets.append(sheet.attrib.get('name', 'Unknown'))
            if not sheets:
                # Fallback: search in raw XML
                content = zip_ref.read('xl/workbook.xml').decode('utf-8')
                import re
                sheets = re.findall(r'name="([^"]+)"', content)
            print("Sheets:", sheets)

        # Try to read RAW sheet
        print("\n=== RAW Sheet Headers ===")
        try:
            with zip_ref.open('xl/worksheets/sheet2.xml') as f:  # Likely sheet2
                content = f.read().decode('utf-8')
                # Extract cell values from first row
                import re
                # Simple regex to find cell values
                values = re.findall(r'<v>([^<]+)</v>', content[:5000])
                print("First row values:", values[:20])
        except:
            print("Could not read sheet2")

        # Try to read form sheet
        print("\n=== Form Sheet (דוח החזר) Headers ===")
        try:
            with zip_ref.open('xl/worksheets/sheet1.xml') as f:
                content = f.read().decode('utf-8')
                import re
                values = re.findall(r'<v>([^<]+)</v>', content[:5000])
                print("First row values:", values[:20])
        except:
            print("Could not read sheet1")

except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()
