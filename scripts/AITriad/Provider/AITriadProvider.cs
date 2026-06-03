// Copyright (c) 2026 Snover International Consulting LLC. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

using System;
using System.Collections;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.IO;
using System.Linq;
using System.Management.Automation;
using System.Management.Automation.Provider;
using System.Text.Json;

namespace AITriad.Provider
{
    #region Data classes

    public class TaxNode
    {
        public string Id { get; set; }
        public string Category { get; set; }
        public string Label { get; set; }
        public string Description { get; set; }
        public string ParentId { get; set; }
        public int Priority { get; set; }
        public string Pov { get; set; }
        public string ParentRelationship { get; set; }
        public string ParentRationale { get; set; }
        public string[] Children { get; set; } = Array.Empty<string>();
        public string[] SituationRefs { get; set; } = Array.Empty<string>();
        public string[] DebateRefs { get; set; } = Array.Empty<string>();
        public JsonElement? GraphAttributes { get; set; }
        public JsonElement? RawJson { get; set; }
    }

    public class PovInfo
    {
        public string DisplayName { get; set; }
        public string Key { get; set; }
        public string ColorHex { get; set; }
        public string FilePath { get; set; }
        public List<TaxNode> Nodes { get; set; } = new List<TaxNode>();
    }

    #endregion

    #region DriveInfo

    public class AITriadDriveInfo : PSDriveInfo
    {
        public Dictionary<string, PovInfo> Povs { get; }
        public string TaxonomyPath { get; set; }

        public AITriadDriveInfo(PSDriveInfo drive) : base(drive)
        {
            Povs = new Dictionary<string, PovInfo>(StringComparer.OrdinalIgnoreCase);
        }
    }

    #endregion

    #region Content reader (Get-Content support)

    public class TaxNodeContentReader : IContentReader
    {
        private readonly string[] _lines;
        private int _offset;

        public TaxNodeContentReader(string text)
        {
            _lines = (text ?? "").Split(new[] { "\r\n", "\n" }, StringSplitOptions.None);
            _offset = 0;
        }

        public IList Read(long readCount)
        {
            var result = new ArrayList();
            long count = readCount <= 0 ? _lines.Length : readCount;
            while (_offset < _lines.Length && result.Count < count)
            {
                result.Add(_lines[_offset]);
                _offset++;
            }
            return result;
        }

        public void Seek(long offset, SeekOrigin origin) { _offset = 0; }
        public void Close() { }
        public void Dispose() { }
    }

    #endregion

    #region Provider

    [CmdletProvider("AITriad", ProviderCapabilities.None)]
    public class AITriadTaxonomyProvider : NavigationCmdletProvider, IContentCmdletProvider
    {
        private static readonly string[] Categories = { "Beliefs", "Desires", "Intentions" };

        private AITriadDriveInfo TypedDrive => PSDriveInfo as AITriadDriveInfo;

        #region Path parsing

        private static string[] ParsePath(string path)
        {
            if (string.IsNullOrEmpty(path)) return Array.Empty<string>();
            return path.Replace('/', '\\').Trim('\\')
                       .Split('\\', StringSplitOptions.RemoveEmptyEntries);
        }

        private enum PathDepth { Root, Pov, Category, Node, Invalid }

        private (PathDepth depth, PovInfo pov, string category, TaxNode node) Resolve(string path)
        {
            if (TypedDrive == null)
                return (PathDepth.Invalid, null, null, null);

            var parts = ParsePath(path);
            if (parts.Length == 0)
                return (PathDepth.Root, null, null, null);

            if (!TypedDrive.Povs.TryGetValue(parts[0], out var pov))
                return (PathDepth.Invalid, null, null, null);
            if (parts.Length == 1)
                return (PathDepth.Pov, pov, null, null);

            var cat = Categories.FirstOrDefault(c =>
                c.Equals(parts[1], StringComparison.OrdinalIgnoreCase));
            if (cat == null)
                return (PathDepth.Invalid, null, null, null);
            if (parts.Length == 2)
                return (PathDepth.Category, pov, cat, null);

            var node = pov.Nodes.FirstOrDefault(n =>
                n.Id.Equals(parts[2], StringComparison.OrdinalIgnoreCase) &&
                n.Category.Equals(cat, StringComparison.OrdinalIgnoreCase));
            if (node == null)
                return (PathDepth.Invalid, null, null, null);
            if (parts.Length == 3)
                return (PathDepth.Node, pov, cat, node);

            return (PathDepth.Invalid, null, null, null);
        }

        #endregion

        #region Drive lifecycle

        protected override PSDriveInfo NewDrive(PSDriveInfo drive)
        {
            var typed = new AITriadDriveInfo(drive);
            // The actual data path is passed via the drive's Description field
            // because Root must be empty for non-filesystem providers.
            // If Description contains a valid directory, use it; otherwise try Root.
            var dataPath = drive.Description;
            if (string.IsNullOrEmpty(dataPath) || !Directory.Exists(dataPath))
                dataPath = drive.Root;
            typed.TaxonomyPath = dataPath;
            LoadTaxonomy(typed);
            return typed;
        }

        protected override PSDriveInfo RemoveDrive(PSDriveInfo drive) => drive;

        private void LoadTaxonomy(AITriadDriveInfo drive)
        {
            var root = drive.TaxonomyPath;
            if (!Directory.Exists(root))
            {
                WriteError(new ErrorRecord(
                    new DirectoryNotFoundException("Taxonomy directory not found: " + root),
                    "TaxonomyDirNotFound", ErrorCategory.ObjectNotFound, root));
                return;
            }

            foreach (var file in Directory.GetFiles(root, "*.json"))
            {
                var fileName = Path.GetFileNameWithoutExtension(file);
                // Skip non-POV auxiliary files
                if (new[] { "embeddings", "edges", "policy_actions", "_archived_edges",
                            "lineage_categories", "interpretation_embeddings",
                            "source_evidence_index", "similarity-cache", "situations" }
                    .Contains(fileName, StringComparer.OrdinalIgnoreCase))
                    continue;

                try
                {
                    var text = File.ReadAllText(file);
                    using var doc = JsonDocument.Parse(text);
                    var rootEl = doc.RootElement;

                    if (!rootEl.TryGetProperty("pov", out var povProp)) continue;
                    if (!rootEl.TryGetProperty("nodes", out var nodesArr)) continue;

                    var povKey = povProp.GetString();
                    var displayName = char.ToUpperInvariant(povKey[0]) + povKey.Substring(1);
                    var colorHex = rootEl.TryGetProperty("color_hex", out var ch) ? ch.GetString() : "";

                    var pov = new PovInfo
                    {
                        DisplayName = displayName,
                        Key = povKey,
                        ColorHex = colorHex,
                        FilePath = file
                    };

                    foreach (var el in nodesArr.EnumerateArray())
                    {
                        var node = new TaxNode
                        {
                            Id = GetString(el, "id"),
                            Category = GetString(el, "category"),
                            Label = GetString(el, "label"),
                            Description = GetString(el, "description"),
                            ParentId = GetString(el, "parent_id"),
                            Priority = el.TryGetProperty("priority", out var pri) && pri.ValueKind == JsonValueKind.Number ? pri.GetInt32() : 0,
                            Pov = povKey,
                            ParentRelationship = GetString(el, "parent_relationship"),
                            ParentRationale = GetString(el, "parent_rationale"),
                            Children = GetStringArray(el, "children"),
                            SituationRefs = GetStringArray(el, "situation_refs"),
                            DebateRefs = GetStringArray(el, "debate_refs"),
                        };

                        if (el.TryGetProperty("graph_attributes", out var ga))
                            node.GraphAttributes = ga.Clone();
                        node.RawJson = el.Clone();

                        pov.Nodes.Add(node);
                    }

                    drive.Povs[displayName] = pov;
                }
                catch (Exception ex)
                {
                    WriteWarning("Failed to load " + file + ": " + ex.Message);
                }
            }
        }

        private static string GetString(JsonElement el, string prop)
        {
            return el.TryGetProperty(prop, out var v) && v.ValueKind == JsonValueKind.String
                ? v.GetString() : "";
        }

        private static string[] GetStringArray(JsonElement el, string prop)
        {
            if (!el.TryGetProperty(prop, out var v) || v.ValueKind != JsonValueKind.Array)
                return Array.Empty<string>();
            var list = new List<string>();
            foreach (var item in v.EnumerateArray())
            {
                if (item.ValueKind == JsonValueKind.String)
                    list.Add(item.GetString());
            }
            return list.ToArray();
        }

        #endregion

        #region ItemCmdletProvider

        protected override bool IsValidPath(string path) => true;

        protected override bool ItemExists(string path)
        {
            return Resolve(path).depth != PathDepth.Invalid;
        }

        protected override void GetItem(string path)
        {
            var (depth, pov, category, node) = Resolve(path);
            switch (depth)
            {
                case PathDepth.Root:
                    var root = new PSObject();
                    root.Properties.Add(new PSNoteProperty("Name", "AITriad Taxonomy"));
                    root.Properties.Add(new PSNoteProperty("POVs", TypedDrive.Povs.Keys.OrderBy(k => k).ToArray()));
                    root.Properties.Add(new PSNoteProperty("TotalNodes", TypedDrive.Povs.Values.Sum(p => p.Nodes.Count)));
                    WriteItemObject(root, path, true);
                    break;

                case PathDepth.Pov:
                    var po = new PSObject();
                    po.Properties.Add(new PSNoteProperty("Name", pov.DisplayName));
                    po.Properties.Add(new PSNoteProperty("POV", pov.Key));
                    po.Properties.Add(new PSNoteProperty("ColorHex", pov.ColorHex));
                    po.Properties.Add(new PSNoteProperty("NodeCount", pov.Nodes.Count));
                    po.Properties.Add(new PSNoteProperty("Beliefs", pov.Nodes.Count(n => Eq(n.Category, "Beliefs"))));
                    po.Properties.Add(new PSNoteProperty("Desires", pov.Nodes.Count(n => Eq(n.Category, "Desires"))));
                    po.Properties.Add(new PSNoteProperty("Intentions", pov.Nodes.Count(n => Eq(n.Category, "Intentions"))));
                    po.Properties.Add(new PSNoteProperty("FilePath", pov.FilePath));
                    po.TypeNames.Insert(0, "AITriad.PovInfo");
                    WriteItemObject(po, path, true);
                    break;

                case PathDepth.Category:
                    var cnt = pov.Nodes.Count(n => Eq(n.Category, category));
                    var co = new PSObject();
                    co.Properties.Add(new PSNoteProperty("Name", category));
                    co.Properties.Add(new PSNoteProperty("POV", pov.Key));
                    co.Properties.Add(new PSNoteProperty("NodeCount", cnt));
                    co.TypeNames.Insert(0, "AITriad.CategoryInfo");
                    WriteItemObject(co, path, true);
                    break;

                case PathDepth.Node:
                    WriteItemObject(NodeToPSObject(node), path, false);
                    break;
            }
        }

        #endregion

        #region ContainerCmdletProvider

        protected override void GetChildItems(string path, bool recurse)
        {
            var (depth, pov, category, _) = Resolve(path);
            switch (depth)
            {
                case PathDepth.Root:
                    foreach (var p in TypedDrive.Povs.Values.OrderBy(p => p.DisplayName))
                    {
                        var obj = new PSObject();
                        obj.Properties.Add(new PSNoteProperty("Name", p.DisplayName));
                        obj.Properties.Add(new PSNoteProperty("ColorHex", p.ColorHex));
                        obj.Properties.Add(new PSNoteProperty("NodeCount", p.Nodes.Count));
                        obj.TypeNames.Insert(0, "AITriad.PovInfo");
                        var childPath = CombinePath(path, p.DisplayName);
                        WriteItemObject(obj, childPath, true);
                        if (recurse) GetChildItems(childPath, true);
                    }
                    break;

                case PathDepth.Pov:
                    foreach (var cat in Categories)
                    {
                        var count = pov.Nodes.Count(n => Eq(n.Category, cat));
                        var obj = new PSObject();
                        obj.Properties.Add(new PSNoteProperty("Name", cat));
                        obj.Properties.Add(new PSNoteProperty("POV", pov.Key));
                        obj.Properties.Add(new PSNoteProperty("NodeCount", count));
                        obj.TypeNames.Insert(0, "AITriad.CategoryInfo");
                        var childPath = CombinePath(path, cat);
                        WriteItemObject(obj, childPath, true);
                        if (recurse) GetChildItems(childPath, true);
                    }
                    break;

                case PathDepth.Category:
                    foreach (var n in pov.Nodes
                        .Where(n => Eq(n.Category, category))
                        .OrderBy(n => n.Id))
                    {
                        WriteItemObject(NodeToPSObject(n), CombinePath(path, n.Id), false);
                    }
                    break;
            }
        }

        protected override void GetChildNames(string path, ReturnContainers returnContainers)
        {
            var (depth, pov, category, _) = Resolve(path);
            switch (depth)
            {
                case PathDepth.Root:
                    foreach (var p in TypedDrive.Povs.Values.OrderBy(p => p.DisplayName))
                        WriteItemObject(p.DisplayName, CombinePath(path, p.DisplayName), true);
                    break;
                case PathDepth.Pov:
                    foreach (var cat in Categories)
                        WriteItemObject(cat, CombinePath(path, cat), true);
                    break;
                case PathDepth.Category:
                    foreach (var n in pov.Nodes
                        .Where(n => Eq(n.Category, category))
                        .OrderBy(n => n.Id))
                        WriteItemObject(n.Id, CombinePath(path, n.Id), false);
                    break;
            }
        }

        protected override bool HasChildItems(string path)
        {
            var (depth, pov, category, _) = Resolve(path);
            switch (depth)
            {
                case PathDepth.Root: return TypedDrive.Povs.Count > 0;
                case PathDepth.Pov: return pov.Nodes.Count > 0;
                case PathDepth.Category: return pov.Nodes.Any(n => Eq(n.Category, category));
                default: return false;
            }
        }

        protected override bool IsItemContainer(string path)
        {
            var d = Resolve(path).depth;
            return d == PathDepth.Root || d == PathDepth.Pov || d == PathDepth.Category;
        }

        #endregion

        #region NavigationCmdletProvider

        protected override string MakePath(string parent, string child)
        {
            if (string.IsNullOrEmpty(parent)) return child ?? "";
            if (string.IsNullOrEmpty(child)) return parent;
            return parent.TrimEnd('\\') + "\\" + child;
        }

        private string CombinePath(string parent, string child)
        {
            if (string.IsNullOrEmpty(parent)) return child ?? "";
            if (string.IsNullOrEmpty(child)) return parent;
            return parent.TrimEnd('\\') + "\\" + child;
        }

        protected override string GetChildName(string path)
        {
            var parts = ParsePath(path);
            return parts.Length > 0 ? parts[parts.Length - 1] : "";
        }

        protected override string GetParentPath(string path, string root)
        {
            var parts = ParsePath(path);
            if (parts.Length <= 1) return "";
            return string.Join("\\", parts.Take(parts.Length - 1));
        }

        protected override string NormalizeRelativePath(string path, string basePath)
        {
            return path;
        }

        #endregion

        #region IContentCmdletProvider

        public IContentReader GetContentReader(string path)
        {
            var (depth, _, _, node) = Resolve(path);
            if (depth == PathDepth.Node && node != null)
                return new TaxNodeContentReader(node.Description);

            WriteError(new ErrorRecord(
                new InvalidOperationException("Get-Content is only supported on leaf nodes (taxonomy entries)."),
                "ContentNotSupported", ErrorCategory.InvalidOperation, path));
            return null;
        }

        public object GetContentReaderDynamicParameters(string path) => null;

        public IContentWriter GetContentWriter(string path)
        {
            throw new PSNotSupportedException("This drive is read-only.");
        }

        public object GetContentWriterDynamicParameters(string path) => null;

        public void ClearContent(string path)
        {
            throw new PSNotSupportedException("This drive is read-only.");
        }

        public object ClearContentDynamicParameters(string path) => null;

        #endregion

        #region Helpers

        private static bool Eq(string a, string b) =>
            string.Equals(a, b, StringComparison.OrdinalIgnoreCase);

        private PSObject NodeToPSObject(TaxNode node)
        {
            var obj = new PSObject();
            obj.Properties.Add(new PSNoteProperty("Id", node.Id));
            obj.Properties.Add(new PSNoteProperty("POV", node.Pov));
            obj.Properties.Add(new PSNoteProperty("Category", node.Category));
            obj.Properties.Add(new PSNoteProperty("Label", node.Label));
            obj.Properties.Add(new PSNoteProperty("Description", node.Description));
            obj.Properties.Add(new PSNoteProperty("ParentId", node.ParentId));
            obj.Properties.Add(new PSNoteProperty("Priority", node.Priority));
            obj.Properties.Add(new PSNoteProperty("ParentRelationship", node.ParentRelationship));
            obj.Properties.Add(new PSNoteProperty("ParentRationale", node.ParentRationale));
            obj.Properties.Add(new PSNoteProperty("Children", node.Children));
            obj.Properties.Add(new PSNoteProperty("SituationRefs", node.SituationRefs));
            obj.Properties.Add(new PSNoteProperty("DebateRefs", node.DebateRefs));

            if (node.GraphAttributes.HasValue)
                obj.Properties.Add(new PSNoteProperty("GraphAttributes",
                    JsonElementToObject(node.GraphAttributes.Value)));

            obj.TypeNames.Insert(0, "AITriad.TaxonomyNode");
            // Also add TaxonomyNode so the existing format file applies
            obj.TypeNames.Insert(1, "TaxonomyNode");
            return obj;
        }

        private static object JsonElementToObject(JsonElement el)
        {
            switch (el.ValueKind)
            {
                case JsonValueKind.Object:
                    var obj = new PSObject();
                    foreach (var prop in el.EnumerateObject())
                        obj.Properties.Add(new PSNoteProperty(prop.Name, JsonElementToObject(prop.Value)));
                    return obj;
                case JsonValueKind.Array:
                    var list = new List<object>();
                    foreach (var item in el.EnumerateArray())
                        list.Add(JsonElementToObject(item));
                    return list.ToArray();
                case JsonValueKind.String:
                    return el.GetString();
                case JsonValueKind.Number:
                    if (el.TryGetInt32(out var i)) return i;
                    if (el.TryGetInt64(out var l)) return l;
                    return el.GetDouble();
                case JsonValueKind.True: return true;
                case JsonValueKind.False: return false;
                default: return null;
            }
        }

        #endregion
    }

    #endregion
}
