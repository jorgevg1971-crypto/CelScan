import zlib
import struct
import math

def create_png(width, height, icon_path):
    raw_data = bytearray()
    
    # Background gradient: Blue/Indigo to Purple
    for y in range(height):
        raw_data.append(0) # Filter type 0 (None)
        for x in range(width):
            # Normalized coordinates (-1 to 1)
            nx = (x - width / 2) / (width / 2)
            ny = (y - height / 2) / (height / 2)
            dist_sq = nx * nx + ny * ny
            
            # Rounded rect background
            # Default dark blue-violet
            r = int(24 + 30 * (y / height))
            g = int(35 + 80 * (x / width))
            b = int(210 - 50 * (y / height))
            a = 255
            
            # Center Document Shape
            doc_left = width * 0.28
            doc_right = width * 0.72
            doc_top = height * 0.22
            doc_bottom = height * 0.78
            
            if doc_left <= x <= doc_right and doc_top <= y <= doc_bottom:
                # Document border & white sheet
                if x <= doc_left + width * 0.03 or x >= doc_right - width * 0.03 or \
                   y <= doc_top + height * 0.03 or y >= doc_bottom - height * 0.03:
                    r, g, b = 56, 189, 248 # Cyan border
                else:
                    r, g, b = 248, 250, 252 # Clean document white
                    
                    # Horizontal text lines simulation
                    line_y = y / height
                    if (0.34 <= line_y <= 0.36 or 0.42 <= line_y <= 0.44 or 0.50 <= line_y <= 0.52 or 0.58 <= line_y <= 0.60) and (x <= doc_right - width * 0.08 and x >= doc_left + width * 0.08):
                        r, g, b = 148, 163, 184 # Slate lines
            
            # Glowing scan line across the middle
            scan_y = height * 0.48
            if abs(y - scan_y) <= height * 0.02 and doc_left - width * 0.05 <= x <= doc_right + width * 0.05:
                r, g, b = 59, 130, 246
            
            raw_data.extend([r, g, b, a])
            
    # PNG format assembly
    def chunk(chunk_type, data):
        return struct.pack('>I', len(data)) + chunk_type + data + struct.pack('>I', zlib.crc32(chunk_type + data) & 0xffffffff)

    header = b'\x89PNG\r\n\x1a\n'
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    ihdr = chunk(b'IHDR', ihdr_data)
    idat = chunk(b'IDAT', zlib.compress(raw_data, 9))
    iend = chunk(b'IEND', b'')

    with open(icon_path, 'wb') as f:
        f.write(header + ihdr + idat + iend)

create_png(192, 192, 'icon-192.png')
create_png(512, 512, 'icon-512.png')
print("Icons generated successfully!")
