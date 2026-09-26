/** 放进 HTML（页面、邮件）之前转义用户和地图数据。 */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
