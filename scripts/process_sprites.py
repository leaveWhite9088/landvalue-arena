# 批量处理素材贴图：黑底抠图 -> 软边 -> 裁切 -> 缩略 -> public/sprites/尺寸-名称.png
import os
from collections import deque
from PIL import Image, ImageFilter

SRC = r"D:\Sandbox\261010gameoptimize\素材"
DST = r"D:\Sandbox\261010gameoptimize\public\sprites"

# 文件名 -> (尺寸标签, 店名)
MAP = {
    "18fe202feb0c78": ("1x1", "7-Eleven"),
    "59aa8c1289c4d8": ("1x1", "罗森"),
    "38963eb1d5329":  ("1x1", "全家"),
    "522af33255ccb8": ("1x1", "便利兔"),
    "5d1689db9a5d38": ("1x1", "星巴克"),
    "95f2c53eae7c6":  ("1x1", "瑞幸咖啡"),
    "88d5d78b1a8ae8": ("1x1", "蜜雪冰城"),
    "9b5757494f8858": ("1x1", "喜茶"),
    "759f668d56e6e8": ("1x1", "霸王茶姬"),
    "1b0c01486179e":  ("1x1", "麦当劳"),
    "d35fd10288043":  ("1x1", "肯德基"),
    "d33f437b1b0388": ("1x1", "汉堡王"),
    "f7661957e5ae1":  ("1x1", "必胜客"),
    "827abbce2d4b1":  ("1x1", "海底捞"),
    "fbe61a1606411":  ("1x1", "耐克"),
    "9f013e2b473ee":  ("1x1", "阿迪达斯"),
    "d37956f025b498": ("1x1", "优衣库"),
    "115cde830f246":  ("1x1", "无印良品"),
    "45cd33eeb0ff18": ("1x1", "名创优品"),
    "a0ed43c8cfdf98": ("1x1", "泡泡玛特"),
    "d8dd5443d9287":  ("1x1", "苹果"),
    "9941c392b9df4":  ("1x1", "小米"),
    "d89b2b103452e":  ("1x1", "华为"),
    "27e1e835a05bc8": ("1x1", "大疆"),
    "d8b7979c200a4":  ("1x1", "蔚来"),
    "6e87e18175af08": ("1x1", "山姆会员店"),
    "a512ced1624028": ("1x1", "迪卡侬"),
    "7942aa08cefa08": ("1x1", "美团外卖"),
    "4fc71e51fab958": ("1x1", "宜家"),
    "9f65e267bfdc8":  ("1x2", "周大福"),
    "035b42a1e88d08": ("1x2", "同仁堂"),
    "44a909857db288": ("1x2", "西西弗书店"),
    "443ea8cdd9e6f8": ("1x2", "MANNER咖啡"),
    "78c4f05019aa5":  ("1x2", "比亚迪"),
    "b77f9b773c6b28": ("1x2", "李宁"),
    "c08188366d3e68": ("1x2", "顺丰速运"),
    "8e94a1679240d":  ("1x2", "奈雪的茶"),
    "1fa12e66ba21c8": ("1x2", "乐高"),
    "6f76c86c021a3":  ("1x2", "特斯拉"),
    "8ee2e91fbfd52":  ("1x2", "盒马鲜生"),
    "045fefbab56ef8": ("2x2", "玩具反斗城"),
    "282a3aadf34398": ("2x2", "家居馆"),
    "d2aec322d90678": ("2x2", "奔驰"),
    "33042d3f9d5c1":  ("2x2", "ZARA"),
    "2c888c3e1a1268": ("2x2", "钟书阁"),
}

# 右上角尺寸卡片大致区域（相对宽高），抠图时先屏蔽，避免卡片被当成主体
CARD_BOX = (0.68, 0.0, 1.0, 0.24)

def is_bg(px, thresh=46):
    r, g, b = px[0], px[1], px[2]
    return r < thresh and g < thresh and b < thresh

def extract(path):
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    px = im.load()
    mask = bytearray(w * h)  # 1 = 背景
    q = deque()
    # 从四边播种：只把近黑色像素当背景
    for x in range(w):
        for y in (0, h - 1):
            if is_bg(px[x, y]) and not mask[y * w + x]:
                mask[y * w + x] = 1
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if is_bg(px[x, y]) and not mask[y * w + x]:
                mask[y * w + x] = 1
                q.append((x, y))
    while q:
        x, y = q.popleft()
        for nx, ny in ((x+1,y),(x-1,y),(x,y+1),(x,y-1)):
            if 0 <= nx < w and 0 <= ny < h and not mask[ny * w + nx] and is_bg(px[nx, ny]):
                mask[ny * w + nx] = 1
                q.append((nx, ny))
    alpha = Image.new("L", (w, h), 255)
    alpha.putdata([0 if m else 255 for m in mask])
    # 屏蔽右上角尺寸卡片（如果连在背景上没被吃掉，也直接抹掉）
    cx0, cy0, cx1, cy1 = CARD_BOX
    for y in range(int(cy0 * h), int(cy1 * h)):
        for x in range(int(cx0 * w), w):
            alpha.putpixel((x, y), 0)
    alpha = alpha.filter(ImageFilter.GaussianBlur(2))
    im.putalpha(alpha)
    bbox = im.getbbox()
    if bbox:
        im = im.crop(bbox)
    im.thumbnail((640, 640), Image.LANCZOS)
    return im

def main():
    os.makedirs(DST, exist_ok=True)
    done, missing = 0, []
    for key, (size, name) in MAP.items():
        src = os.path.join(SRC, key + ".png")
        if not os.path.exists(src):
            missing.append(key)
            continue
        im = extract(src)
        out = os.path.join(DST, f"{size}-{name}.png")
        im.save(out)
        done += 1
        print(f"{key} -> {size}-{name}.png {im.size}")
    # 删除旧贴图
    for old in ("tesla.png", "qshop.png"):
        p = os.path.join(DST, old)
        if os.path.exists(p):
            os.remove(p)
            print(f"deleted {old}")
    print(f"done={done} missing={missing}")

if __name__ == "__main__":
    main()
