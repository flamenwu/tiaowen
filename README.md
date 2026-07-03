# 铁板神数条文查询网站

这是一个纯静态查询网站，适合直接发布到 GitHub Pages。

## 本地查看

直接双击 `index.html` 即可打开查询。

## 发布到 GitHub Pages

1. 在 GitHub 新建一个仓库，例如 `tiaowen`。
2. 把本文件夹里的全部文件上传到仓库根目录。
3. 打开仓库的 `Settings` -> `Pages`。
4. 在 `Build and deployment` 里选择 `Deploy from a branch`。
5. Branch 选择 `main`，目录选择 `/root`，保存。
6. 等 GitHub Pages 部署完成后，就可以用页面地址访问。

## 文件说明

- `index.html`：网页入口
- `style.css`：页面样式
- `app.js`：编号查询逻辑
- `data.js`：12000 条编号、条文、详解数据
- `assets/`：页面图形资源
