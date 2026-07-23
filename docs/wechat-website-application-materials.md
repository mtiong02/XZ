# 鲜知微信网站应用申请资料

## 申请类型

- 平台：微信开放平台
- 应用类型：网站应用（网站扫码登录）
- 应用名称：鲜知
- 英文名称：XianZhi（可选）
- 应用官网：`https://busybeeenglish.site`
- 授权回调域：`busybeeenglish.site`
- 实际回调地址：`https://busybeeenglish.site/api/v1/auth/wechat/callback`

## 网站应用简介

推荐填写：

> 鲜知是面向家庭的智能饮食管家，帮助家庭管理冰箱食材、安排餐食、减少食材浪费，并提供温和、实用的饮食提醒。

英文简介（可选）：

> XianZhi is a family food assistant that helps households manage ingredients, plan meals, reduce food waste, and receive friendly reminders.

## 应用图片

- 28×28 PNG：`output/wechat-app-assets/xiaozhi-28.png`
- 108×108 PNG：`output/wechat-app-assets/xiaozhi-108.png`
- 两张图片均来自项目正式小知 IP，透明背景，未加入第三方文字或水印。

## 网站信息登记表

请从微信开放平台下载官方《微信开放平台网站信息登记表》，填写真实主体信息后打印、盖章、扫描上传。以下信息可用于填写，但不能替代主体证照或公章：

- 网站名称：鲜知
- 网站域名：`busybeeenglish.site`
- 网站用途：家庭食材管理、餐食规划、饮食提醒和家庭健康管理
- 官网首页：`https://busybeeenglish.site`
- 技术联系人：填写真实负责人
- 主体名称、统一社会信用代码、盖章：填写真实主体资料

不要自行制作或伪造盖章文件；微信审核需要真实主体资料。

## 审核前检查

1. `https://busybeeenglish.site` 能正常打开。
2. 首页有隐私政策、用户协议和联系方式。
3. 回调域填写 `busybeeenglish.site`，不要填写完整路径。
4. 申请通过后保存 AppID 和 AppSecret，不要提交到 Git 或发送到聊天中。
5. 将 AppID、AppSecret 和服务端密钥写入服务器受保护的 `.env`，再重启 API。
