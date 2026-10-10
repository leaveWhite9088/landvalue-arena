# 为两格建筑生成旋转朝向贴图：水平镜像，1x2-*.png -> 1x2-*-r.png
import os
from PIL import Image

SRC = r"D:\Sandbox\261010gameoptimize\public\sprites"

def main():
    done = 0
    for name in os.listdir(SRC):
        if not name.startswith("1x2-") or name.endswith("-r.png"):
            continue
        im = Image.open(os.path.join(SRC, name))
        out = name[:-4] + "-r.png"
        im.transpose(Image.FLIP_LEFT_RIGHT).save(os.path.join(SRC, out))
        done += 1
        print(name, "->", out)
    print("done =", done)

if __name__ == "__main__":
    main()
